"""Rejected stage: the decisions RejectService makes, with the database mocked out.

The locking and the email claim are SQL, so they are exercised against Postgres separately
(see the PR body); these pin the rules."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

from pydantic import ValidationError as PydanticError

from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ConflictError
from app.main import app
from app.schemas.schemas import RejectionEmailRequest
from app.services import reject_service as rs
from app.services.interview_status import is_live as interview_is_live


class EmailHelpersTests(unittest.TestCase):
    def test_usable_email(self):
        ok = NS(parsed_data=None, email="a@b.com")
        self.assertEqual(rs._usable_email(ok), "a@b.com")
        self.assertIsNone(rs._usable_email(NS(parsed_data=None, email="erased-1@erased.local")))
        self.assertIsNone(rs._usable_email(NS(parsed_data=None, email="x@upload.pending")))
        self.assertIsNone(rs._usable_email(None))

    def test_claim_freshness(self):
        now = datetime.now(timezone.utc)
        self.assertFalse(rs._claim_is_fresh(NS(rejection_email_claimed_at=None), now))
        self.assertTrue(rs._claim_is_fresh(NS(rejection_email_claimed_at=now - timedelta(minutes=1)), now))
        self.assertFalse(
            rs._claim_is_fresh(NS(rejection_email_claimed_at=now - rs.CLAIM_STALE_AFTER - timedelta(seconds=1)), now)
        )


class InterviewLiveTests(unittest.TestCase):
    def test_live_and_stuck(self):
        now = datetime.now(timezone.utc)
        self.assertTrue(interview_is_live(NS(status="in_progress", started_at=now)))
        self.assertTrue(interview_is_live(NS(status="in_progress", started_at=None)))
        self.assertFalse(interview_is_live(NS(status="in_progress", started_at=now - timedelta(hours=5))))
        self.assertFalse(interview_is_live(NS(status="completed", started_at=now)))


class RequestShapeTests(unittest.TestCase):
    def test_email_batch_is_one_to_ten(self):
        ids = [uuid.uuid4() for _ in range(10)]
        self.assertEqual(len(RejectionEmailRequest(candidate_ids=ids).candidate_ids), 10)
        for bad in ([], ids + [uuid.uuid4()]):
            with self.assertRaises(PydanticError):
                RejectionEmailRequest(candidate_ids=bad)

    def test_routes_are_registered(self):
        paths = {(m, r.path) for r in app.routes for m in getattr(r, "methods", ())}
        for expected in (
            ("GET", "/api/jobs/{job_id}/rejected"),
            ("POST", "/api/jobs/{job_id}/rejected/email"),
            ("POST", "/api/jobs/{job_id}/rejected/{candidate_id}/reconsider"),
            ("POST", "/api/jobs/{job_id}/candidates/{candidate_id}/reject"),
        ):
            self.assertIn(expected, paths)


def _call(**kw):
    base = dict(call_status="completed", call_outcome="completed", result="pass", vapi_call_id="v", ended_reason=None,
                summary="ok", transcript=None, retry_count=0, created_at=datetime.now(timezone.utc))
    base.update(kw)
    return NS(**base)


def _session(**kw):
    base = dict(status="completed", round_number=1, voided_at=None, started_at=None,
                created_at=datetime.now(timezone.utc))
    base.update(kw)
    return NS(**base)


class _ServiceHelpers:
    def _service(self, row, calls=(), sessions=()):
        db = MagicMock()
        db.commit = AsyncMock()
        audit = MagicMock()
        audit.log_change = AsyncMock()
        svc = rs.RejectService(db, audit_service=audit)
        cand = NS(id=uuid.uuid4(), status="active", name="C", parsed_data=None)
        job = NS(id=uuid.uuid4())
        svc._lock = AsyncMock(return_value=(job, cand, row, list(calls), list(sessions)))
        return svc, db, audit

    def _row(self, decision="approved", **kw):
        base = dict(id=uuid.uuid4(), hr_decision=decision, rejected_from=None, rejected_at=None, rejected_by=None,
                    rejection_email_claimed_at=None, rejection_emailed_at=None, reconsider_state=None,
                    finalist_at=None)
        base.update(kw)
        return NS(**base)

    async def _reject(self, row, calls=(), sessions=()):
        svc, db, audit = self._service(row, calls, sessions)
        out = await svc.reject(NS(id=uuid.uuid4()), uuid.uuid4(), uuid.uuid4())
        return out, db, audit


class RejectRulesTests(_ServiceHelpers, unittest.IsolatedAsyncioTestCase):

    async def test_no_shortlist_row_is_refused_before_anything_changes(self):
        svc, db, _ = self._service(None)
        with self.assertRaises(ConflictError):
            await svc.reject(NS(id=uuid.uuid4()), uuid.uuid4(), uuid.uuid4())
        db.commit.assert_awaited()  # lock released

    async def test_origin_resume_phone_interview(self):
        out, *_ = await self._reject(self._row("pending"))
        self.assertEqual(out.rejected_from, "resume")
        out, *_ = await self._reject(self._row("overridden"))
        self.assertEqual(out.rejected_from, "resume")
        out, *_ = await self._reject(self._row("approved"))
        self.assertEqual(out.rejected_from, "phone")
        out, *_ = await self._reject(self._row("approved"), sessions=[_session(status="cancelled")])
        self.assertEqual(out.rejected_from, "interview")

    async def test_record_written_and_no_email(self):
        row = self._row("pending")
        with patch("app.services.shortlist_service.ShortlistService.send_rejection_email", AsyncMock()) as mail:
            _, db, audit = await self._reject(row)
        self.assertEqual((row.hr_decision, row.rejected_from), ("rejected", "resume"))
        self.assertIsNotNone(row.rejected_at)
        self.assertIsNone(row.rejection_emailed_at)
        mail.assert_not_awaited()
        audit.log_change.assert_awaited_once()
        self.assertEqual(audit.log_change.await_args.kwargs["action"], "shortlist.rejected")

    async def test_repeat_is_a_noop(self):
        row = self._row("rejected", rejected_from="phone")
        out, db, audit = await self._reject(row)
        self.assertFalse(out.changed)
        self.assertEqual(out.rejected_from, "phone")
        audit.log_change.assert_not_awaited()

    async def test_refused_while_live_or_finalist_and_nothing_changed(self):
        for label, calls, sessions, row_kw in (
            ("call", [_call(call_status="in_progress")], [], {}),
            ("placed call", [_call(call_status="pending", result=None)], [], {}),
            ("interview", [], [_session(status="in_progress", started_at=datetime.now(timezone.utc))], {}),
            ("finalist", [], [_session()], {"finalist_at": datetime.now(timezone.utc)}),
        ):
            with self.subTest(label):
                row = self._row("approved", **row_kw)
                svc, db, audit = self._service(row, calls, sessions)
                with self.assertRaises(ConflictError):
                    await svc.reject(NS(id=uuid.uuid4()), uuid.uuid4(), uuid.uuid4())
                self.assertEqual(row.hr_decision, "approved")
                audit.log_change.assert_not_awaited()

    async def test_unstarted_calls_are_cancelled(self):
        queued = _call(call_status="pending", vapi_call_id=None, result=None)
        await self._reject(self._row("approved"), calls=[queued])
        self.assertEqual(queued.call_status, "cancelled")

    async def test_interview_rejection_records_the_interview_origin(self):
        latest = _session(status="completed")
        row = self._row("approved")
        await self._reject(row, sessions=[latest])
        self.assertEqual((row.rejected_from, row.reconsider_state), ("interview", "interview"))
        self.assertEqual(latest.status, "completed")  # a taken round is history, never rewritten

    async def test_phone_reconsider_state_comes_from_real_calls_only(self):
        done = _call(result="pass")
        failed = _call(result="fail")
        skipped = _call(vapi_call_id=None, ended_reason="skipped", summary="Screening bypassed — x")
        for calls, expected in (([done], "phone_completed"), ([failed], "phone_failed"), ([skipped, failed], "phone_failed"), ([], None)):
            with self.subTest(expected=expected):
                row = self._row("approved")
                await self._reject(row, calls=calls)
                self.assertEqual(row.reconsider_state, expected)

    async def test_overridden_is_remembered(self):
        row = self._row("overridden")
        await self._reject(row)
        self.assertEqual(row.reconsider_state, "resume_overridden")


class ReconsiderRulesTests(_ServiceHelpers, unittest.IsolatedAsyncioTestCase):
    async def _reconsider(self, row, calls=(), sessions=()):
        svc, db, audit = self._service(row, calls, sessions)
        out = await svc.reconsider(NS(id=uuid.uuid4()), uuid.uuid4(), uuid.uuid4())
        return out, db, audit

    async def test_refused_when_not_rejected_emailed_or_being_sent(self):
        now = datetime.now(timezone.utc)
        for label, row in (
            ("not rejected", self._row("approved")),
            ("emailed", self._row("rejected", rejection_emailed_at=now)),
            ("sending", self._row("rejected", rejection_email_claimed_at=now - timedelta(minutes=1))),
        ):
            with self.subTest(label):
                svc, db, audit = self._service(row)
                with self.assertRaises(ConflictError):
                    await svc.reconsider(NS(id=uuid.uuid4()), uuid.uuid4(), uuid.uuid4())
                self.assertEqual(row.hr_decision, "rejected" if label != "not rejected" else "approved")
                audit.log_change.assert_not_awaited()

    async def test_stale_claim_does_not_block(self):
        stale = datetime.now(timezone.utc) - rs.CLAIM_STALE_AFTER - timedelta(minutes=1)
        row = self._row("rejected", rejected_from="resume", rejection_email_claimed_at=stale)
        await self._reconsider(row)
        self.assertEqual(row.hr_decision, "pending")

    async def test_restores_per_origin_and_clears_the_record(self):
        cases = (
            (dict(rejected_from="resume"), "pending"),
            (dict(rejected_from="resume", reconsider_state="resume_overridden"), "overridden"),
            (dict(rejected_from="phone", reconsider_state="phone_completed"), "approved"),
            (dict(rejected_from="interview", reconsider_state="interview"), "approved"),
        )
        for kw, expected in cases:
            with self.subTest(kw):
                row = self._row("rejected", rejected_at=datetime.now(timezone.utc), rejected_by=uuid.uuid4(), **kw)
                await self._reconsider(row, sessions=[_session()])
                self.assertEqual(row.hr_decision, expected)
                self.assertIsNone(row.rejected_from)
                self.assertIsNone(row.rejected_at)
                self.assertIsNone(row.reconsider_state)

    async def test_phone_with_a_finished_call_is_not_redialled(self):
        row = self._row("rejected", rejected_from="phone", reconsider_state="phone_completed")
        with patch("app.services.shortlist_service.ShortlistService._handle_approval_side_effects", AsyncMock()) as side:
            await self._reconsider(row)
        side.assert_not_awaited()

    async def test_phone_with_no_call_result_gets_a_fresh_call(self):
        row = self._row("rejected", rejected_from="phone")
        with patch("app.services.shortlist_service.ShortlistService._handle_approval_side_effects", AsyncMock()) as side:
            await self._reconsider(row)
        side.assert_awaited_once()

    async def test_failed_call_goes_back_to_needs_review(self):
        failed = _call(result="fail")
        row = self._row("rejected", rejected_from="phone", reconsider_state="phone_failed")
        await self._reconsider(row, calls=[failed])
        self.assertEqual(failed.result, "needs_review")

    async def test_interview_reconsider_leaves_the_rounds_alone(self):
        latest = _session(status="completed")
        row = self._row("rejected", rejected_from="interview", reconsider_state="interview")
        await self._reconsider(row, sessions=[latest])
        self.assertEqual((row.hr_decision, latest.status), ("approved", "completed"))


if __name__ == "__main__":
    unittest.main()
