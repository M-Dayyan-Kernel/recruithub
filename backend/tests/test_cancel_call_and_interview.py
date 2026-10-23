"""Cancelling a queued screening call and a pending interview link."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ConflictError, NotFoundError
from app.schemas.schemas import InterviewCancelRequest
from app.services import interview_cancel_service as ics
from app.services.email_template_service import (
    TEMPLATE_IDS,
    TEMPLATE_PLACEHOLDERS,
    default_templates,
    merge_templates,
    render_template,
    validate_template,
)
from app.services.hiring_stage_resolver import resolve_hiring_stage
from app.services.interview_flag_service import get_flag_reason
from app.services.interview_hr_service import InterviewHrService
from app.services.interview_pipeline_service import classify_interview_tab
from app.services.interview_reschedule_service import _expire_session
from app.services.screening_cancel_service import ScreeningCancelService
from app.tasks.screening_tasks import can_set_call_status

NOW = datetime(2026, 10, 22, 10, 0, tzinfo=timezone.utc)


def _result(rows=None, one=None):
    r = MagicMock()
    r.scalars.return_value.all.return_value = rows or []
    r.scalars.return_value.first.return_value = one
    return r


def _sess(status="pending", **kw):
    base = dict(id=uuid.uuid4(), status=status, started_at=None, transcript=None, hr_decision="pending",
                expires_at=NOW + timedelta(days=5), scheduled_interview_at=None, created_at=NOW,
                unique_token="t", job_id=uuid.uuid4())
    base.update(kw)
    return SimpleNamespace(**base)


class CancelPendingSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_pending_session_is_cancelled_and_returned(self):
        sess = _sess("cancelled")
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_result(one=sess))
        out = await ics.cancel_pending_session(db, candidate_id=uuid.uuid4(), job_id=uuid.uuid4())
        self.assertIs(out, sess)
        self.assertEqual(db.execute.await_count, 1)  # one conditional UPDATE ... RETURNING, nothing else

    async def test_nothing_pending_explains_why_by_the_latest_state(self):
        cases = {
            "in_progress": "right now",
            "completed": "already been completed",
            "assessed": "already been completed",
            "expired": "already expired",
            "cancelled": "already been cancelled",
        }
        for status, phrase in cases.items():
            db = AsyncMock()
            db.execute = AsyncMock(side_effect=[_result(one=None), _result(one=_sess(status))])
            with self.assertRaises(ConflictError) as ctx:
                await ics.cancel_pending_session(db, candidate_id=uuid.uuid4(), job_id=uuid.uuid4())
            self.assertIn(phrase, ctx.exception.public_message, status)

    async def test_a_pending_link_that_has_already_lapsed_is_reported_as_expired(self):
        # The UPDATE's expiry condition skipped it, so the latest session is still "pending".
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[_result(one=None), _result(one=_sess("pending", expires_at=NOW - timedelta(days=1)))])
        with self.assertRaises(ConflictError) as ctx:
            await ics.cancel_pending_session(db, candidate_id=uuid.uuid4(), job_id=uuid.uuid4())
        self.assertIn("already expired", ctx.exception.public_message)

    async def test_no_session_at_all_is_a_404(self):
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[_result(one=None), _result(one=None)])
        with self.assertRaises(NotFoundError):
            await ics.cancel_pending_session(db, candidate_id=uuid.uuid4(), job_id=uuid.uuid4())


class HrCancelTests(unittest.IsolatedAsyncioTestCase):
    def _service(self, session):
        db = AsyncMock()
        audit = AsyncMock()
        svc = InterviewHrService(db, interview_repo=MagicMock(), audit_service=audit)
        svc._candidate_label = AsyncMock(return_value="Jane")
        return svc, db, audit

    async def _run(self, notify, email_result=True, scheduled=None):
        sess = _sess("cancelled", scheduled_interview_at=scheduled)
        svc, db, audit = self._service(sess)
        actor = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4())
        cand = SimpleNamespace(id=uuid.uuid4(), job_id=uuid.uuid4())
        with patch("app.services.interview_hr_service.get_tenant_candidate", AsyncMock(return_value=cand)), \
             patch("app.services.interview_cancel_service.cancel_pending_session", AsyncMock(return_value=sess)), \
             patch("app.services.interview_cancel_service.send_cancelled_email", AsyncMock(return_value=email_result)) as mail:
            out = await svc.cancel(actor, cand.id, InterviewCancelRequest(notify_candidate=notify))
        return out, audit, db, mail, sess

    async def test_cancel_without_notifying_sends_no_email(self):
        out, audit, db, mail, sess = await self._run(False)
        mail.assert_not_awaited()
        self.assertIsNone(out.email_sent)
        self.assertEqual(out.status, "cancelled")
        kw = audit.log_change.await_args.kwargs
        self.assertEqual(kw["action"], "interview.cancelled")
        self.assertEqual(kw["after"], {"status": "cancelled", "email_requested": False})
        db.commit.assert_awaited_once()

    async def test_cancel_with_notify_reports_whether_the_email_went(self):
        out, audit, *_ = await self._run(True, email_result=True)
        self.assertTrue(out.email_sent)
        self.assertTrue(audit.log_change.await_args.kwargs["after"]["email_requested"])
        out, audit, *_ = await self._run(True, email_result=False)
        self.assertFalse(out.email_sent)  # cancelled all the same; the caller is told

    async def test_the_cancellation_is_committed_before_the_email_is_sent(self):
        order = []
        sess = _sess("cancelled")
        svc, db, audit = self._service(sess)
        db.commit = AsyncMock(side_effect=lambda: order.append("commit"))

        async def mail(*a, **k):
            order.append("email")
            return True

        actor = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4())
        cand = SimpleNamespace(id=uuid.uuid4(), job_id=uuid.uuid4())
        with patch("app.services.interview_hr_service.get_tenant_candidate", AsyncMock(return_value=cand)), \
             patch("app.services.interview_cancel_service.cancel_pending_session", AsyncMock(return_value=sess)), \
             patch("app.services.interview_cancel_service.send_cancelled_email", mail):
            await svc.cancel(actor, cand.id, InterviewCancelRequest(notify_candidate=True))
        self.assertEqual(order, ["commit", "email"])

    async def test_the_scheduled_time_is_kept_in_the_audit_row(self):
        at = NOW + timedelta(days=2)
        _, audit, *_ = await self._run(False, scheduled=at)
        self.assertEqual(audit.log_change.await_args.kwargs["before"]["scheduled_interview_at"], at.isoformat())


class CancelledSessionEverywhereTests(unittest.IsolatedAsyncioTestCase):
    def test_a_cancelled_session_is_not_flagged(self):
        self.assertIsNone(get_flag_reason(_sess("cancelled")))
        # even with a long-past expiry (cancelling sets one)
        self.assertIsNone(get_flag_reason(_sess("cancelled", expires_at=NOW - timedelta(days=1))))

    def test_a_cancelled_session_is_filed_under_scheduled(self):
        self.assertEqual(classify_interview_tab(_sess("cancelled")), "scheduled")

    async def test_rescheduling_after_a_cancellation_keeps_it_cancelled(self):
        s = _sess("cancelled")
        await _expire_session(s)
        self.assertEqual(s.status, "cancelled")
        s = _sess("pending")
        await _expire_session(s)
        self.assertEqual(s.status, "expired")

    def test_the_candidates_page_keeps_them_in_the_stage(self):
        cand = SimpleNamespace(status="active", pipeline_status="completed")
        self.assertEqual(
            resolve_hiring_stage(cand, shortlist=SimpleNamespace(hr_decision="approved"),
                                 screening=SimpleNamespace(call_status="completed", result="pass"),
                                 interview_session=_sess("cancelled")),
            "Interview",
        )
        self.assertEqual(
            resolve_hiring_stage(cand, shortlist=SimpleNamespace(hr_decision="approved"),
                                 screening=SimpleNamespace(call_status="cancelled", result=None)),
            "Screening",
        )

    def test_a_cancelled_call_can_never_be_revived_by_a_late_status(self):
        self.assertFalse(can_set_call_status("cancelled", "in_progress"))
        self.assertFalse(can_set_call_status("cancelled", "completed"))


class DispatchRespectsACancelTests(unittest.IsolatedAsyncioTestCase):
    async def test_newest_call_cancelled_is_detected(self):
        from app.services.screening_trigger_service import newest_call_is_cancelled

        for status, expected in (("cancelled", True), ("pending", False), ("failed", False), (None, False)):
            db = AsyncMock()
            r = MagicMock()
            r.scalar_one_or_none.return_value = status
            db.execute = AsyncMock(return_value=r)
            self.assertEqual(await newest_call_is_cancelled(db, uuid.uuid4(), uuid.uuid4()), expected, status)


class CancelledEmailTemplateTests(unittest.TestCase):
    def test_the_template_exists_with_defaults_and_placeholders(self):
        self.assertIn("interview_cancelled", TEMPLATE_IDS)
        self.assertEqual(TEMPLATE_PLACEHOLDERS["interview_cancelled"], ("{{candidate_name}}", "{{job_title}}"))
        d = default_templates()["interview_cancelled"]
        self.assertTrue(d["subject"] and d["body_html"])
        self.assertEqual(validate_template("interview_cancelled", d["subject"], d["body_html"]), [])

    def test_it_renders_with_the_candidate_and_job(self):
        subject, body = render_template(
            "interview_cancelled",
            merge_templates(None),
            {"candidate_name": "Jane Doe", "job_title": "Backend Engineer", "company_name": "Acme"},
        )
        self.assertEqual(subject, "[Interview Cancelled] Backend Engineer at Acme")
        self.assertIn("Jane Doe", body)
        self.assertIn("Backend Engineer", body)
        self.assertNotIn("{{", body)
        self.assertNotIn("interview_url", body)  # the link is dead, so the email carries none

    def test_a_tenant_with_saved_templates_still_gets_the_new_default(self):
        merged = merge_templates({"rejection": {"subject": "x", "body_html": "y"}})
        self.assertEqual(merged["interview_cancelled"], default_templates()["interview_cancelled"])
        self.assertEqual(merged["rejection"]["subject"], "x")


def _call(status="pending", vapi=None, outcome=None):
    return SimpleNamespace(id=uuid.uuid4(), call_status=status, vapi_call_id=vapi, call_outcome=outcome,
                           summary=None, created_at=NOW)


class ScreeningCancelTests(unittest.IsolatedAsyncioTestCase):
    async def _run(self, calls, *, approved=True, effective=True):
        db = AsyncMock()
        added = []
        db.add = MagicMock(side_effect=added.append)
        db.execute = AsyncMock(side_effect=[
            _result(one=uuid.uuid4() if approved else None),   # approved shortlist row
            _result(rows=calls),                                # the candidate's calls
        ])
        audit = AsyncMock()
        svc = ScreeningCancelService(db, audit_service=audit)
        job = SimpleNamespace(id=uuid.uuid4(), voice_screening_enabled=effective)
        cand = SimpleNamespace(id=uuid.uuid4(), job_id=job.id, name="Jane", parsed_data={})
        actor = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4())
        with patch("app.services.screening_cancel_service.get_tenant_job", AsyncMock(return_value=job)), \
             patch("app.services.screening_cancel_service.get_tenant_candidate", AsyncMock(return_value=cand)), \
             patch("app.services.settings_service.load_system_settings", AsyncMock(return_value=SimpleNamespace())):
            try:
                out = await svc.cancel(actor, job.id, cand.id)
            except ConflictError as exc:
                return None, exc, db, audit, added
        return out, None, db, audit, added

    async def test_a_queued_call_is_cancelled(self):
        c = _call("pending")
        out, err, db, audit, added = await self._run([c])
        self.assertIsNone(err)
        self.assertEqual((c.call_status, out.cancelled), ("cancelled", 1))
        self.assertEqual(added, [])  # no marker needed: the queued row itself was cancelled
        kw = audit.log_change.await_args.kwargs
        self.assertEqual((kw["action"], kw["before"], kw["after"]),
                         ("screening.call_cancelled", {"call_status": "pending"}, {"call_status": "cancelled"}))
        db.commit.assert_awaited_once()

    async def test_every_queued_row_is_cancelled(self):
        a, b = _call("pending"), _call("pending")
        out, err, *_ = await self._run([a, b, _call("completed")])
        self.assertEqual((a.call_status, b.call_status, out.cancelled), ("cancelled", "cancelled", 2))

    async def test_an_approved_candidate_with_no_call_yet_gets_a_cancelled_marker(self):
        out, err, db, audit, added = await self._run([])
        self.assertIsNone(err)
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0].call_status, "cancelled")
        self.assertIsNone(added[0].vapi_call_id)
        self.assertEqual(audit.log_change.await_args.kwargs["before"], {"call_status": None})

    async def test_a_live_or_placed_call_cannot_be_cancelled(self):
        for call in (_call("initiated", "v"), _call("in_progress", "v"), _call("pending", "v")):
            out, err, db, audit, added = await self._run([call])
            self.assertIsInstance(err, ConflictError, call.call_status)
            self.assertIn("in progress", err.public_message)
            self.assertNotEqual(call.call_status, "cancelled")
            audit.log_change.assert_not_awaited()
            db.commit.assert_not_awaited()

    async def test_nothing_queued_is_refused_with_a_reason(self):
        out, err, db, audit, added = await self._run([_call("completed"), _call("failed")])
        self.assertIn("no queued call", err.public_message)
        out, err, *_ = await self._run([_call("cancelled")])
        self.assertIn("already been cancelled", err.public_message)
        # a failed attempt followed by a cancelled one: the newest decides
        older = _call("failed")
        older.created_at = NOW
        newer = _call("cancelled")
        newer.created_at = NOW + timedelta(minutes=1)
        out, err, *_ = await self._run([older, newer])
        self.assertIn("already been cancelled", err.public_message)

    async def test_screening_off_or_not_approved_is_refused(self):
        out, err, *_ = await self._run([], effective=False)
        self.assertIn("turned off", err.public_message)
        out, err, *_ = await self._run([], approved=False)
        self.assertIn("not in the phone round", err.public_message)


if __name__ == "__main__":
    unittest.main()
