"""Moving a candidate out of the phone round by hand (Phone screening tab)."""

import unittest
import uuid
from types import SimpleNamespace

from pydantic import ValidationError as PydanticValidationError

from app.schemas.schemas import PhoneRoundAdvanceRequest
from app.services.hiring_stage_resolver import resolve_hiring_stage


class AdvanceRequestTests(unittest.TestCase):
    def test_a_reason_is_required(self):
        for reason in ("", "   ", "     ", "ok", "  ok  "):
            with self.assertRaises(PydanticValidationError, msg=repr(reason)):
                PhoneRoundAdvanceRequest(candidate_id=uuid.uuid4(), reason=reason)

    def test_the_reason_is_stored_trimmed(self):
        self.assertEqual(PhoneRoundAdvanceRequest(candidate_id=uuid.uuid4(), reason="  by email  ").reason, "by email")

    def test_a_real_reason_is_accepted_and_capped(self):
        PhoneRoundAdvanceRequest(candidate_id=uuid.uuid4(), reason="Spoke to them by email")
        with self.assertRaises(PydanticValidationError):
            PhoneRoundAdvanceRequest(candidate_id=uuid.uuid4(), reason="x" * 501)


class RejectedLabelTests(unittest.TestCase):
    def test_a_rejected_candidate_reads_rejected_whatever_their_last_call(self):
        cand = SimpleNamespace(status="active", pipeline_status="completed")
        for call in (
            SimpleNamespace(call_status="cancelled", result=None),
            SimpleNamespace(call_status="pending", result=None),
            SimpleNamespace(call_status="failed", result=None),
        ):
            self.assertEqual(
                resolve_hiring_stage(cand, shortlist=SimpleNamespace(hr_decision="rejected", finalist_at=None), screening=call),
                "Rejected",
                call.call_status,
            )

    def test_an_approved_candidate_with_a_cancelled_call_is_still_in_screening(self):
        cand = SimpleNamespace(status="active", pipeline_status="completed")
        self.assertEqual(
            resolve_hiring_stage(cand, shortlist=SimpleNamespace(hr_decision="approved", finalist_at=None),
                                 screening=SimpleNamespace(call_status="cancelled", result=None)),
            "Screening",
        )


if __name__ == "__main__":
    unittest.main()


# ── PhoneRoundService rules (mocked database) ────────────────────────────────

from datetime import datetime, timezone  # noqa: E402
from unittest.mock import AsyncMock, MagicMock, patch  # noqa: E402

from app.exceptions import ConflictError  # noqa: E402
from app.services.phone_round_service import PhoneRoundService  # noqa: E402

NOW = datetime(2026, 10, 22, tzinfo=timezone.utc)


def _res(rows=None, first=None):
    r = MagicMock()
    r.scalars.return_value.all.return_value = rows or []
    r.scalars.return_value.first.return_value = first
    return r


def _call(status, result=None, vapi=None, outcome=None):
    return SimpleNamespace(id=uuid.uuid4(), call_status=status, result=result, vapi_call_id=vapi, call_outcome=outcome,
                           transcript=None, retry_count=0, created_at=NOW, summary=None)


class PhoneRoundServiceTests(unittest.IsolatedAsyncioTestCase):
    def _svc(self, *, decision="approved", sessions=(), calls=()):
        db = AsyncMock()
        row = SimpleNamespace(id=uuid.uuid4(), hr_decision=decision)
        db.execute = AsyncMock(side_effect=[_res(first=row), _res(rows=list(sessions)), _res(rows=list(calls))])
        audit = AsyncMock()
        svc = PhoneRoundService(db, audit_service=audit)
        return svc, db, audit, row

    def _patches(self):
        job = SimpleNamespace(id=uuid.uuid4(), voice_screening_enabled=True)
        cand = SimpleNamespace(id=uuid.uuid4(), job_id=job.id, phone="+919876543210", name="Jane", parsed_data={})
        return job, cand, [
            patch("app.services.phone_round_service.get_tenant_job", AsyncMock(return_value=job)),
            patch("app.services.phone_round_service.get_tenant_candidate", AsyncMock(return_value=cand)),
            patch("app.services.settings_service.load_system_settings", AsyncMock(return_value=SimpleNamespace(enforce_phone_geography=False, allowed_phone_regions=[], screening_max_retries=3))),
        ]

    async def _run(self, kind, **kw):
        svc, db, audit, row = self._svc(**kw)
        job, cand, ps = self._patches()
        actor = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4(), full_name="HR", role="hr")
        advance = AsyncMock(return_value=SimpleNamespace(session_id=uuid.uuid4(), email_sent=True, created=True, email_skipped_reason=None))
        rejection = AsyncMock(return_value=True)
        for p in ps:
            p.start()
        try:
            with patch("app.services.interview_skip_screening_service.advance_approved_candidate_to_interview", advance), \
                 patch("app.services.shortlist_service.ShortlistService.send_rejection_email", rejection):
                try:
                    out = await (svc.advance(actor, job.id, cand.id, "by email") if kind == "advance" else svc.reject(actor, job.id, cand.id))
                    err = None
                except ConflictError as e:
                    out, err = None, e
        finally:
            for p in ps:
                p.stop()
        return out, err, db, audit, row, advance, rejection

    async def test_refusals(self):
        cases = [
            ({"decision": "pending"}, "not in the phone round"),
            ({"sessions": [SimpleNamespace()]}, "Interviews"),
            ({"calls": [_call("in_progress", vapi="v")]}, "in progress"),
            ({"calls": [_call("pending", vapi="v")]}, "in progress"),
            ({"calls": [_call("completed", "fail")]}, "has a result"),
            ({"calls": [_call("completed", "pass")]}, "Interviews"),
        ]
        for kw, phrase in cases:
            for kind in ("advance", "reject"):
                out, err, db, audit, row, advance, rejection = await self._run(kind, **kw)
                self.assertIsInstance(err, ConflictError, (kind, kw))
                self.assertIn(phrase, err.public_message, (kind, kw))
                audit.log_change.assert_not_awaited()
                advance.assert_not_awaited()
                db.commit.assert_not_awaited()

    async def test_advance_cancels_undialled_calls_audits_then_moves_with_its_own_bypass(self):
        queued = _call("pending")
        flagged = _call("failed", vapi="v1", outcome="failed")
        out, err, db, audit, row, advance, _ = await self._run("advance", calls=[flagged, queued])
        self.assertIsNone(err)
        self.assertEqual(queued.call_status, "cancelled")
        self.assertEqual(flagged.call_status, "failed")
        audit.log_change.assert_awaited_once()
        self.assertEqual(audit.log_change.await_args.kwargs["after"], {"reason": "by email"})
        kwargs = advance.await_args.kwargs
        self.assertFalse(kwargs["reuse_existing_pass"])
        self.assertIn("by email", kwargs["bypass_summary"])
        self.assertTrue(out.email_sent)

    async def test_reject_goes_to_the_rejected_stage_with_no_email(self):
        order = []
        flagged = _call("failed", vapi="v1", outcome="failed")
        svc, db, audit, row = self._svc(calls=[flagged])
        db.commit = AsyncMock(side_effect=lambda: order.append("commit"))
        job, cand, ps = self._patches()
        actor = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4(), full_name="HR", role="hr")

        async def reject(self_, actor_, job_id, cand_id):
            order.append("reject")

        for p in ps:
            p.start()
        try:
            with patch("app.services.reject_service.RejectService.reject", reject), patch(
                "app.services.shortlist_service.ShortlistService.send_rejection_email", AsyncMock()
            ) as mail:
                out = await svc.reject(actor, job.id, cand.id)
        finally:
            for p in ps:
                p.stop()
        # the phone round's own checks release their locks before the Rejected stage takes its own
        self.assertEqual(order, ["commit", "reject"])
        mail.assert_not_awaited()
        self.assertFalse(out.email_sent)

    async def test_reject_is_refused_when_the_phone_round_checks_fail(self):
        live = _call("in_progress", vapi="v1")
        svc, db, audit, row = self._svc(calls=[live])
        job, cand, ps = self._patches()
        actor = SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4(), full_name="HR", role="hr")
        for p in ps:
            p.start()
        try:
            with patch("app.services.reject_service.RejectService.reject", AsyncMock()) as reject:
                with self.assertRaises(ConflictError):
                    await svc.reject(actor, job.id, cand.id)
        finally:
            for p in ps:
                p.stop()
        reject.assert_not_awaited()
