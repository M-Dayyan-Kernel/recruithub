"""Interview rounds: the current round, what HR may do, and moving between rounds."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ConflictError, ValidationError
from app.services import interview_round_service as rounds
from app.services.interview_round_service import (
    ACTION_CANCEL,
    ACTION_MARK_FINALIST,
    ACTION_NEXT_ROUND,
    ACTION_REJECT,
    ACTION_RESCHEDULE,
    ACTION_RETRY_ASSESSMENT,
    ACTION_SCHEDULE,
    ACTION_VOID_ROUND,
    available_actions,
    counted_rounds,
    latest_round,
)

NOW = datetime(2026, 10, 31, 10, 0, tzinfo=timezone.utc)


def _round(status="completed", round_number=1, voided=False, minutes=0, started=None, **kw):
    base = dict(
        id=uuid.uuid4(), candidate_id=uuid.uuid4(), job_id=uuid.uuid4(), unique_token=f"tok-{uuid.uuid4()}",
        status=status, round_number=round_number, voided_at=NOW if voided else None, void_reason=None,
        voided_by_user_id=None, created_at=NOW + timedelta(minutes=minutes), started_at=started,
        completed_at=None, scheduled_interview_at=None, expires_at=NOW + timedelta(days=3),
        livekit_room_name=None, egress_id=None, recording_key=None, recording_ready=None,
        transcript=None, transcript_segments=None,
    )
    base.update(kw)
    return NS(**base)


def _row(**kw):
    base = dict(hr_decision="approved", finalist_at=None, finalist_by_user_id=None)
    base.update(kw)
    return NS(**base)


class CurrentRoundTests(unittest.TestCase):
    def test_no_sessions_means_no_round(self):
        self.assertIsNone(latest_round([]))
        self.assertEqual(counted_rounds([]), [])

    def test_highest_round_is_current(self):
        r1, r2 = _round(round_number=1), _round("pending", round_number=2)
        self.assertIs(latest_round([r2, r1]), r2)

    def test_a_voided_round_is_replaced_by_its_retake(self):
        voided = _round(round_number=1, voided=True)
        retake = _round("pending", round_number=1, minutes=5)
        self.assertEqual(counted_rounds([voided, retake]), [retake])
        self.assertIs(latest_round([voided, retake]), retake)

    def test_an_all_voided_application_has_no_current_round(self):
        self.assertIsNone(latest_round([_round(voided=True)]))


class AvailableActionsTests(unittest.TestCase):
    def _actions(self, sessions, **kw):
        kw.setdefault("rejected", False)
        kw.setdefault("finalist", False)
        return available_actions(sessions, **kw)

    def test_no_round_yet_can_be_scheduled(self):
        self.assertEqual(self._actions([]), [ACTION_SCHEDULE, ACTION_REJECT])

    def test_rejected_has_no_actions(self):
        self.assertEqual(self._actions([_round("pending")], rejected=True), [])

    def test_pending_can_be_rescheduled_or_cancelled(self):
        self.assertEqual(self._actions([_round("pending")]), [ACTION_RESCHEDULE, ACTION_CANCEL, ACTION_REJECT])

    def test_untaken_rounds_can_only_be_rescheduled(self):
        for status in ("expired", "cancelled"):
            with self.subTest(status):
                self.assertEqual(self._actions([_round(status)]), [ACTION_RESCHEDULE, ACTION_REJECT])

    def test_a_live_interview_has_no_actions(self):
        live = _round("in_progress", started=datetime.now(timezone.utc))
        self.assertEqual(self._actions([live]), [])

    def test_a_stuck_interview_waits_for_the_sweeper(self):
        stuck = _round("in_progress", started=datetime.now(timezone.utc) - timedelta(hours=3))
        self.assertEqual(self._actions([stuck]), [])

    def test_a_taken_round_moves_on_never_back(self):
        for status in ("completed", "assessed"):
            with self.subTest(status):
                actions = self._actions([_round(status)])
                self.assertEqual(actions, [ACTION_NEXT_ROUND, ACTION_MARK_FINALIST, ACTION_VOID_ROUND, ACTION_REJECT])
                self.assertNotIn(ACTION_RESCHEDULE, actions)

    def test_the_last_allowed_round_cannot_open_another(self):
        sessions = [_round(round_number=n) for n in (1, 2, 3)]
        self.assertEqual(self._actions(sessions), [ACTION_MARK_FINALIST, ACTION_VOID_ROUND, ACTION_REJECT])

    def test_a_voided_round_does_not_count_toward_the_cap(self):
        sessions = [_round(round_number=1), _round(round_number=2),
                    _round(round_number=3, voided=True), _round(round_number=3, minutes=5)]
        self.assertEqual(len(counted_rounds(sessions)), 3)
        self.assertNotIn(ACTION_NEXT_ROUND, self._actions(sessions))
        sessions = [_round(round_number=1), _round(round_number=2, voided=True), _round("pending", round_number=2, minutes=5)]
        self.assertEqual(len(counted_rounds(sessions)), 2)

    def test_a_flagged_round_cannot_be_marked_a_finalist(self):
        self.assertEqual(
            self._actions([_round("completed")], flagged=True), [ACTION_NEXT_ROUND, ACTION_VOID_ROUND, ACTION_REJECT]
        )

    def test_a_failed_assessment_can_be_retried(self):
        self.assertIn(ACTION_RETRY_ASSESSMENT, self._actions([_round("assessment_failed")]))

    def test_a_finalist_can_no_longer_change(self):
        self.assertEqual(self._actions([_round("completed")], finalist=True), [])
        self.assertEqual(self._actions([_round("assessment_failed")], finalist=True), [ACTION_RETRY_ASSESSMENT])

    def test_reject_is_offered_until_the_candidate_is_a_finalist_or_in_the_room(self):
        self.assertIn(ACTION_REJECT, self._actions([]))
        self.assertIn(ACTION_REJECT, self._actions([_round("completed")]))
        self.assertNotIn(ACTION_REJECT, self._actions([_round("completed")], finalist=True))
        live = _round("in_progress", started=datetime.now(timezone.utc))
        self.assertNotIn(ACTION_REJECT, self._actions([live]))


class _Rounds:
    """Patches the two reads (shortlist row and sessions) so the rules run without a database."""

    def _db(self):
        db = AsyncMock()
        db.add = MagicMock()
        return db

    async def _call(self, fn, sessions, row=None, **kw):
        db = self._db()
        row = row if row is not None else _row()
        self.ensure_plan = AsyncMock()
        with patch.object(rounds, "_shortlist", AsyncMock(return_value=row)), \
             patch.object(rounds, "load_sessions", AsyncMock(return_value=sessions)), \
             patch.object(rounds, "ensure_plan", self.ensure_plan):
            out = await fn(db, candidate_id=uuid.uuid4(), job_id=uuid.uuid4(), **kw)
        return out, db


class PlaceFirstRoundTests(_Rounds, unittest.IsolatedAsyncioTestCase):
    async def test_creates_round_one(self):
        session, db = await self._call(rounds.place_first_round, [])
        self.assertEqual((session.round_number, session.status), (1, "pending"))
        self.assertTrue(session.unique_token)
        db.add.assert_called_once_with(session)
        db.flush.assert_awaited()
        self.ensure_plan.assert_awaited_once_with(db, session)

    async def test_the_link_expires_from_the_slot(self):
        slot = datetime.now(timezone.utc) + timedelta(days=2)
        session, _ = await self._call(rounds.place_first_round, [], scheduled_at=slot)
        self.assertEqual(session.scheduled_interview_at, slot)
        self.assertGreater(session.expires_at, slot)

    async def test_a_pending_round_is_not_replaced(self):
        with self.assertRaisesRegex(ConflictError, "already exists"):
            await self._call(rounds.place_first_round, [_round("pending")])

    async def test_a_taken_round_points_to_the_next_round(self):
        with self.assertRaisesRegex(ConflictError, "Schedule the next round"):
            await self._call(rounds.place_first_round, [_round("completed")])

    async def test_a_live_interview_is_refused(self):
        live = _round("in_progress", started=datetime.now(timezone.utc))
        with self.assertRaisesRegex(ConflictError, "in progress"):
            await self._call(rounds.place_first_round, [live])

    async def test_a_round_that_never_closed_is_not_reopened_over_its_recording(self):
        stuck = _round("in_progress", started=datetime.now(timezone.utc) - timedelta(hours=3),
                       transcript="partial", livekit_room_name="room")
        with self.assertRaisesRegex(ConflictError, "being settled"):
            await self._call(rounds.place_first_round, [stuck])
        self.assertEqual((stuck.status, stuck.transcript, stuck.livekit_room_name), ("in_progress", "partial", "room"))

    async def test_a_cancelled_or_expired_round_is_reopened_not_duplicated(self):
        for status in ("cancelled", "expired"):
            with self.subTest(status):
                old = _round(status, started=NOW, livekit_room_name="room", transcript="partial", egress_id="e")
                session, db = await self._call(rounds.place_first_round, [old])
                self.assertIs(session, old)
                self.assertEqual(old.status, "pending")
                self.assertEqual(old.round_number, 1)
                self.assertIsNone(old.started_at)
                self.assertIsNone(old.livekit_room_name)
                self.assertIsNone(old.transcript)
                self.assertIsNone(old.egress_id)
                db.add.assert_not_called()
                self.ensure_plan.assert_not_awaited()  # a reopened round keeps the plan it has

    async def test_a_rejected_or_finalist_application_is_refused(self):
        for row in (_row(hr_decision="rejected"), _row(finalist_at=NOW)):
            with self.subTest(row=row), self.assertRaises(ConflictError):
                await self._call(rounds.place_first_round, [], row=row)

    async def test_a_past_time_is_refused(self):
        with self.assertRaises(ValidationError):
            await self._call(rounds.place_first_round, [], scheduled_at=datetime.now(timezone.utc) - timedelta(days=1))


class RescheduleRoundTests(_Rounds, unittest.IsolatedAsyncioTestCase):
    async def test_moves_the_same_session_and_keeps_its_link(self):
        old_slot = datetime.now(timezone.utc) + timedelta(days=1)
        new_slot = datetime.now(timezone.utc) + timedelta(days=4)
        pending = _round("pending", scheduled_interview_at=old_slot)
        token = pending.unique_token
        (session, previous), db = await self._call(rounds.reschedule_round, [pending], scheduled_at=new_slot)
        self.assertIs(session, pending)
        self.assertEqual(previous, old_slot)
        self.assertEqual(pending.scheduled_interview_at, new_slot)
        self.assertEqual(pending.unique_token, token)
        db.add.assert_not_called()

    async def test_a_taken_round_cannot_be_rescheduled(self):
        for status in ("completed", "assessed", "assessment_failed"):
            with self.subTest(status), self.assertRaisesRegex(ConflictError, "next round"):
                await self._call(rounds.reschedule_round, [_round(status)])

    async def test_a_live_round_cannot_be_rescheduled(self):
        live = _round("in_progress", started=datetime.now(timezone.utc))
        with self.assertRaisesRegex(ConflictError, "in progress"):
            await self._call(rounds.reschedule_round, [live])

    async def test_a_round_that_never_closed_cannot_be_rescheduled(self):
        stuck = _round("in_progress", started=datetime.now(timezone.utc) - timedelta(hours=3))
        with self.assertRaisesRegex(ConflictError, "being settled"):
            await self._call(rounds.reschedule_round, [stuck])
        self.assertEqual(stuck.status, "in_progress")

    async def test_nothing_to_reschedule(self):
        with self.assertRaises(ValidationError):
            await self._call(rounds.reschedule_round, [])

    async def test_an_expired_round_comes_back_pending(self):
        expired = _round("expired")
        await self._call(rounds.reschedule_round, [expired])
        self.assertEqual(expired.status, "pending")


class ScheduleNextRoundTests(_Rounds, unittest.IsolatedAsyncioTestCase):
    async def test_opens_round_two_after_a_taken_round(self):
        session, db = await self._call(rounds.schedule_next_round, [_round("assessed")])
        self.assertEqual((session.round_number, session.status), (2, "pending"))
        db.add.assert_called_once_with(session)

    async def test_the_cap_is_enforced(self):
        sessions = [_round(round_number=n) for n in (1, 2, 3)]
        with self.assertRaisesRegex(ConflictError, "at most 3"):
            await self._call(rounds.schedule_next_round, sessions)

    async def test_an_untaken_round_is_rescheduled_instead(self):
        for status in ("pending", "expired", "cancelled"):
            with self.subTest(status), self.assertRaisesRegex(ConflictError, "Reschedule"):
                await self._call(rounds.schedule_next_round, [_round(status)])

    async def test_a_live_round_is_refused(self):
        live = _round("in_progress", started=datetime.now(timezone.utc))
        with self.assertRaisesRegex(ConflictError, "in progress"):
            await self._call(rounds.schedule_next_round, [live])

    async def test_a_round_that_never_closed_blocks_the_next_round_and_a_void(self):
        stuck = _round("in_progress", started=datetime.now(timezone.utc) - timedelta(hours=3))
        for fn, kw in ((rounds.schedule_next_round, {}), (rounds.void_round, {"reason": "x", "actor_id": uuid.uuid4()})):
            with self.subTest(fn.__name__), self.assertRaises(ConflictError):
                await self._call(fn, [stuck], **kw)
        self.assertEqual(stuck.status, "in_progress")

    async def test_needs_an_earlier_round(self):
        with self.assertRaises(ValidationError):
            await self._call(rounds.schedule_next_round, [])

    async def test_numbers_continue_after_a_void(self):
        sessions = [_round(round_number=1, voided=True), _round(round_number=1, minutes=5)]
        session, _ = await self._call(rounds.schedule_next_round, sessions)
        self.assertEqual(session.round_number, 2)
        self.ensure_plan.assert_awaited_once()

    async def test_a_finalist_or_rejected_application_is_refused(self):
        for row in (_row(hr_decision="rejected"), _row(finalist_at=NOW)):
            with self.subTest(row=row), self.assertRaises(ConflictError):
                await self._call(rounds.schedule_next_round, [_round()], row=row)


class VoidRoundTests(_Rounds, unittest.IsolatedAsyncioTestCase):
    async def test_voids_the_round_and_opens_a_retake_with_the_same_number(self):
        taken = _round("assessed", round_number=2)
        actor = uuid.uuid4()
        (voided, retake), db = await self._call(
            rounds.void_round, [_round(round_number=1), taken], reason="  Mic failed  ", actor_id=actor
        )
        self.assertIs(voided, taken)
        self.assertIsNotNone(taken.voided_at)
        self.assertEqual((taken.void_reason, taken.voided_by_user_id), ("Mic failed", actor))
        self.assertEqual((retake.round_number, retake.status), (2, "pending"))
        self.assertNotEqual(retake.unique_token, taken.unique_token)
        # The voided row is flushed before the retake is added, so the unique round index holds.
        self.assertEqual(db.flush.await_count, 2)
        self.ensure_plan.assert_awaited_once_with(db, retake)

    async def test_needs_a_reason(self):
        for reason in ("", "   "):
            with self.subTest(reason), self.assertRaises(ValidationError):
                await self._call(rounds.void_round, [_round()], reason=reason, actor_id=uuid.uuid4())

    async def test_only_a_taken_round_can_be_voided(self):
        for status in ("pending", "expired", "cancelled"):
            with self.subTest(status), self.assertRaises(ConflictError):
                await self._call(rounds.void_round, [_round(status)], reason="x", actor_id=uuid.uuid4())
        with self.assertRaises(ConflictError):
            await self._call(rounds.void_round, [], reason="x", actor_id=uuid.uuid4())

    async def test_a_live_round_cannot_be_voided(self):
        live = _round("in_progress", started=datetime.now(timezone.utc))
        with self.assertRaises(ConflictError):
            await self._call(rounds.void_round, [live], reason="x", actor_id=uuid.uuid4())

    async def test_a_finalist_cannot_be_voided(self):
        with self.assertRaises(ConflictError):
            await self._call(rounds.void_round, [_round()], row=_row(finalist_at=NOW), reason="x", actor_id=uuid.uuid4())


if __name__ == "__main__":
    unittest.main()
