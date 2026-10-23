"""Decision rules on the Resume Screening tab, and the stage shown for approved rows."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ConflictError
from app.models.models import User
from app.schemas.schemas import ShortlistDecisionUpdate
from app.services.shortlist_service import ShortlistService
from app.services.shortlist_stage_service import resolve_shortlist_stage

NOW = datetime(2026, 10, 22, 10, 0, tzinfo=timezone.utc)


def _call(status="completed", result=None, vapi="v1", minutes=0, outcome=None, transcript=None, retries=0, created=None):
    return SimpleNamespace(call_status=status, result=result, vapi_call_id=vapi, call_outcome=outcome,
                           transcript=transcript, retry_count=retries,
                           created_at=created or (NOW + timedelta(minutes=minutes)))


def _session(status="pending", decision="pending", at=None, minutes=0, started=None, expires=None, transcript=None):
    return SimpleNamespace(status=status, hr_decision=decision, scheduled_interview_at=at,
                           created_at=NOW + timedelta(minutes=minutes), started_at=started,
                           expires_at=expires or (NOW + timedelta(days=30)), transcript=transcript)


def _settings(enforce=False, regions=("IN",), retries=3):
    return SimpleNamespace(enforce_phone_geography=enforce, allowed_phone_regions=list(regions), screening_max_retries=retries)


PHONE = "+91 98765 43210"


def _stage(decision="approved", calls=(), sessions=(), phone=PHONE, settings=None, effective=True, now=NOW + timedelta(hours=1), report=False):
    s = resolve_shortlist_stage(decision, list(calls), list(sessions), has_report=report, phone=phone,
                                settings=settings or _settings(), screening_effective=effective, now=now)
    return None if s is None else (s.kind, s.state)


class StageTests(unittest.TestCase):
    def test_only_approved_rows_have_a_stage(self):
        for decision in ("pending", "rejected", "overridden"):
            self.assertIsNone(_stage(decision, calls=[_call()]))

    def test_approved_with_nothing_dispatched_is_queued(self):
        self.assertEqual(_stage(), ("screening", "queued"))

    def test_call_states(self):
        self.assertEqual(_stage(calls=[_call("initiated")]), ("screening", "live"))
        self.assertEqual(_stage(calls=[_call("in_progress")]), ("screening", "live"))
        self.assertEqual(_stage(calls=[_call("pending", vapi=None)]), ("screening", "scheduled"))
        # placed but not yet answered: the Phone screening tab files it under Pending
        self.assertEqual(_stage(calls=[_call("pending", vapi="v")]), ("screening", "queued"))
        self.assertEqual(_stage(calls=[_call("completed", "fail")]), ("screening", "failed"))
        self.assertEqual(_stage(calls=[_call("completed", "needs_review", transcript="hello")]), ("screening", "review"))
        self.assertEqual(_stage(calls=[_call("failed")]), ("screening", "flagged"))

    def test_passed_call_moves_to_the_interview_stage(self):
        self.assertEqual(_stage(calls=[_call("completed", "pass")]), ("interview", "pending"))

    def test_flagged_carries_a_readable_reason(self):
        s = resolve_shortlist_stage("approved", [_call(outcome="declined")], [], phone=PHONE, settings=_settings())
        self.assertEqual((s.state, s.reason), ("flagged", "Candidate declined the call"))

    def test_phone_problems_flag_even_before_any_call(self):
        self.assertEqual(_stage(phone=None), ("screening", "flagged"))
        self.assertEqual(_stage(phone="12345"), ("screening", "queued"))  # geography not enforced
        self.assertEqual(_stage(phone="+1 415 555 0100", settings=_settings(enforce=True)), ("screening", "flagged"))
        self.assertEqual(_stage(phone="+91 98765 43210", settings=_settings(enforce=True)), ("screening", "queued"))
        self.assertEqual(_stage(phone="9876543210", settings=_settings(enforce=True)), ("screening", "queued"))

    def test_a_finished_call_keeps_its_outcome_whatever_the_phone_says_now(self):
        self.assertEqual(_stage(calls=[_call("completed", "fail")], phone=None), ("screening", "failed"))
        self.assertEqual(_stage(calls=[_call("completed", "pass")], phone="+1 415 555 0100", settings=_settings(enforce=True)), ("interview", "pending"))
        # with no outcome yet, the phone still decides
        self.assertEqual(_stage(calls=[_call("pending", vapi=None)], phone=None), ("screening", "flagged"))

    def test_declined_and_technical_failures_flag(self):
        self.assertEqual(_stage(calls=[_call("completed", outcome="declined")]), ("screening", "flagged"))
        self.assertEqual(_stage(calls=[_call("completed", outcome="failed")]), ("screening", "flagged"))

    def test_connect_failures_retry_until_attempts_run_out(self):
        self.assertEqual(_stage(calls=[_call("completed", outcome="no_answer", retries=0)]), ("screening", "retrying"))
        self.assertEqual(_stage(calls=[_call("completed", outcome="voicemail", retries=1)]), ("screening", "retrying"))
        self.assertEqual(_stage(calls=[_call("completed", outcome="no_answer", retries=2)]), ("screening", "flagged"))
        self.assertEqual(_stage(calls=[_call("completed", outcome="dropped", retries=5)]), ("screening", "flagged"))

    def test_a_just_dialled_final_retry_still_reads_as_retrying(self):
        fresh = _call("completed", outcome="no_answer", retries=2, created=NOW)
        self.assertEqual(_stage(calls=[fresh], now=NOW + timedelta(seconds=5)), ("screening", "retrying"))
        self.assertEqual(_stage(calls=[fresh], now=NOW + timedelta(seconds=60)), ("screening", "flagged"))

    def test_an_answered_retry_beats_an_early_no_answer_outcome(self):
        answered = _call("completed", "pass", outcome="no_answer", transcript="x" * 80, retries=2)
        self.assertEqual(_stage(calls=[answered]), ("interview", "pending"))

    def test_a_live_call_beats_an_older_finished_one(self):
        calls = [_call("completed", "fail", minutes=0), _call("initiated", minutes=5)]
        self.assertEqual(_stage(calls=calls), ("screening", "live"))

    def test_a_call_after_a_result_is_a_new_round(self):
        # e.g. failed, rejected, approved again: the new round's call is what is happening
        calls = [_call("completed", "fail", minutes=0), _call("failed", minutes=5)]
        self.assertEqual(_stage(calls=calls), ("screening", "flagged"))

    def test_a_cancelled_call_keeps_the_candidate_in_screening(self):
        self.assertEqual(_stage(calls=[_call("cancelled", vapi=None)]), ("screening", "cancelled"))
        # a later real call outranks the cancelled marker only by being newer/live
        self.assertEqual(
            _stage(calls=[_call("cancelled", vapi=None, minutes=0), _call("initiated", minutes=5)]),
            ("screening", "live"),
        )

    def test_a_cancelled_interview_keeps_the_candidate_in_interviews(self):
        self.assertEqual(_stage(sessions=[_session("cancelled")]), ("interview", "cancelled"))
        # a new link after the cancellation takes over
        sessions = [_session("cancelled", minutes=0), _session("pending", minutes=5)]
        self.assertEqual(_stage(sessions=sessions), ("interview", "link_sent"))

    def test_a_new_round_after_a_result_shows_the_new_round(self):
        old_fail = _call("completed", "fail", minutes=0)
        self.assertEqual(_stage(calls=[old_fail, _call("pending", vapi=None, minutes=5)]), ("screening", "scheduled"))
        self.assertEqual(_stage(calls=[old_fail, _call("cancelled", vapi=None, minutes=5)]), ("screening", "cancelled"))
        # ...including once the new call is placed, or ends unanswered
        self.assertEqual(_stage(calls=[old_fail, _call("pending", vapi="v", minutes=5)]), ("screening", "queued"))
        self.assertEqual(_stage(calls=[old_fail, _call("completed", outcome="no_answer", minutes=5)]), ("screening", "retrying"))
        # an older queued row does not override a newer result
        self.assertEqual(_stage(calls=[_call("pending", vapi=None, minutes=0), _call("completed", "fail", minutes=5)]), ("screening", "failed"))

    def test_screening_switched_off_without_a_session_means_interview_next(self):
        self.assertEqual(_stage(effective=False), ("interview", "pending"))

    def test_screening_off_leaves_the_phone_round_paused_not_mislabelled(self):
        # Nothing will call them now: they wait for HR to place them.
        for call in (_call("pending", vapi=None), _call("cancelled", vapi=None), _call("failed")):
            self.assertEqual(_stage(calls=[call], effective=False), ("screening", "paused"), call.call_status)
        # ...but a call with an outcome, or a live one, still says what it is
        self.assertEqual(_stage(calls=[_call("completed", "fail")], effective=False), ("screening", "failed"))
        self.assertEqual(_stage(calls=[_call("in_progress")], effective=False), ("screening", "live"))

    def test_interview_states(self):
        started = NOW - timedelta(minutes=5)
        self.assertEqual(_stage(sessions=[_session("pending")]), ("interview", "link_sent"))
        self.assertEqual(_stage(sessions=[_session("in_progress", started=started)]), ("interview", "live"))
        for status in ("completed", "assessed", "assessment_failed"):
            self.assertEqual(_stage(sessions=[_session(status, started=started)]), ("interview", "completed"), status)
        self.assertEqual(_stage(sessions=[_session("completed", "approved", started=started)]), ("interview", "finalist"))

    def test_sessions_the_interviews_tab_flags_are_flagged_here_too(self):
        # status "expired" and a pending link past its expiry, neither ever joined
        for sess in (_session("expired"), _session("pending", expires=NOW - timedelta(days=1))):
            s = resolve_shortlist_stage("approved", [], [sess], phone=PHONE)
            self.assertEqual((s.kind, s.state), ("interview", "flagged"))
            self.assertIn("never joined", s.reason)
        # completed but never started
        s = resolve_shortlist_stage("approved", [], [_session("completed")], phone=PHONE)
        self.assertEqual(s.state, "flagged")
        self.assertIn("never started", s.reason)

    def test_a_report_keeps_a_finished_interview_out_of_flagged(self):
        self.assertEqual(_stage(sessions=[_session("completed")], report=True), ("interview", "completed"))

    def test_scheduled_time_is_carried_for_a_sent_link(self):
        at = NOW + timedelta(days=2)
        stage = resolve_shortlist_stage("approved", [], [_session("pending", at=at)], phone=PHONE)
        self.assertEqual(stage.scheduled_at, at)

    def test_newest_session_wins_and_beats_any_call(self):
        sessions = [_session("expired", minutes=0), _session("pending", minutes=9)]
        self.assertEqual(_stage(calls=[_call("completed", "fail")], sessions=sessions), ("interview", "link_sent"))


def _record(decision):
    # A namespace, not a MagicMock: the response schema reads optional attributes
    # (interview_session_id, ...) that a mock would answer with another mock.
    return SimpleNamespace(
        id=uuid.uuid4(), candidate_id=uuid.uuid4(), job_id=uuid.uuid4(), hr_decision=decision,
        match_score=80.0, recommendation="shortlisted", strengths=[], gaps=[], reason="ok",
        hr_feedback_type=None, hr_comments=None, model_name="m", prompt_version="v", created_at=NOW,
    )


def _actor():
    return User(id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com", full_name="HR",
                hashed_password="x", role="hr", is_active=True)


def _service(record):
    session = AsyncMock()
    session.get = AsyncMock(return_value=SimpleNamespace(name="Jane", email="j@example.com", phone=None, parsed_data={}))
    repo = MagicMock()
    repo.get_for_tenant_locked = AsyncMock(return_value=record)
    repo.refresh = AsyncMock()
    audit = AsyncMock()
    svc = ShortlistService(session, shortlist_repo=repo, audit_service=audit)
    svc._send_rejection_email = AsyncMock()
    svc._handle_approval_side_effects = AsyncMock(return_value=None)
    return svc, session, audit


class DecisionRuleTests(unittest.IsolatedAsyncioTestCase):
    async def _decide(self, current, new):
        record = _record(current)
        svc, session, audit = _service(record)
        try:
            result = await svc.update_decision(_actor(), record.id, ShortlistDecisionUpdate(hr_decision=new))
            return svc, session, audit, record, result, None
        except ConflictError as exc:
            return svc, session, audit, record, None, exc

    async def test_approving_a_pending_row_runs_the_side_effects_once(self):
        svc, session, audit, record, result, err = await self._decide("pending", "approved")
        self.assertIsNone(err)
        self.assertEqual(result.hr_decision, "approved")
        svc._handle_approval_side_effects.assert_awaited_once()
        audit.log_change.assert_awaited_once()

    async def test_a_repeat_approve_does_nothing(self):
        svc, session, audit, record, result, err = await self._decide("approved", "approved")
        self.assertIsNone(err)
        self.assertEqual(result.hr_decision, "approved")
        svc._handle_approval_side_effects.assert_not_awaited()
        svc._send_rejection_email.assert_not_awaited()
        audit.log_change.assert_not_awaited()
        session.rollback.assert_not_awaited()  # would expire the request's other objects

    async def test_a_repeat_reject_does_nothing(self):
        svc, session, audit, record, result, err = await self._decide("rejected", "rejected")
        self.assertIsNone(err)
        svc._send_rejection_email.assert_not_awaited()
        audit.log_change.assert_not_awaited()

    async def test_an_approved_row_cannot_be_rejected_or_overridden(self):
        for new in ("rejected", "overridden"):
            svc, session, audit, record, result, err = await self._decide("approved", new)
            self.assertIsInstance(err, ConflictError, new)
            self.assertEqual(record.hr_decision, "approved")
            svc._send_rejection_email.assert_not_awaited()
            audit.log_change.assert_not_awaited()
            svc._handle_approval_side_effects.assert_not_awaited()
            session.rollback.assert_not_awaited()

    async def test_a_rejected_row_can_still_be_approved(self):
        svc, session, audit, record, result, err = await self._decide("rejected", "approved")
        self.assertIsNone(err)
        svc._handle_approval_side_effects.assert_awaited_once()

    async def test_rejecting_a_pending_row_sends_one_email(self):
        svc, session, audit, record, result, err = await self._decide("pending", "rejected")
        self.assertIsNone(err)
        svc._send_rejection_email.assert_awaited_once()
        svc._handle_approval_side_effects.assert_not_awaited()


class ListStageTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_approved_rows_get_a_stage(self):
        approved, pending = _record("approved"), _record("pending")
        session = AsyncMock()

        def _result(rows):
            r = MagicMock()
            r.scalars.return_value.all.return_value = rows
            return r

        candidates = [
            SimpleNamespace(id=c.candidate_id, parsed_data={}, name="Jane", email="j@x.com", phone=PHONE)
            for c in (approved, pending)
        ]
        # 1st query: the candidates; then the approved candidates' calls, sessions and reports.
        session.execute = AsyncMock(side_effect=[_result(candidates), _result([]), _result([]), _result([])])
        repo = MagicMock()
        repo.list_for_job = AsyncMock(return_value=[approved, pending])
        svc = ShortlistService(session, shortlist_repo=repo)
        with patch("app.services.shortlist_service.get_tenant_job", AsyncMock(return_value=SimpleNamespace(voice_screening_enabled=True))), \
             patch("app.services.settings_service.load_system_settings", AsyncMock(return_value=_settings())):
            rows = await svc.list_results(_actor(), approved.job_id)
        by_id = {r.id: r for r in rows}
        self.assertEqual((by_id[approved.id].stage.kind, by_id[approved.id].stage.state), ("screening", "queued"))
        self.assertIsNone(by_id[pending.id].stage)


if __name__ == "__main__":
    unittest.main()
