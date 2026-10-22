"""The voice-screening switch and re-approval after an earlier round."""

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ValidationError
from app.schemas.schemas import VoiceScreeningCandidate, VoiceScreeningChange, VoiceScreeningPreview
from app.services.screening_trigger_service import call_state_on_approval
from app.services.shortlist_service import ShortlistService
from app.services.voice_screening_service import PHONE_ROUND_STATES, VoiceScreeningService


def _rows(*pairs):
    r = MagicMock()
    r.all.return_value = list(pairs)
    return r


class CallStateOnApprovalTests(unittest.IsolatedAsyncioTestCase):
    async def _state(self, *pairs):
        db = AsyncMock()
        db.execute = AsyncMock(return_value=_rows(*pairs))
        return await call_state_on_approval(db, uuid.uuid4(), uuid.uuid4())

    async def test_never_called(self):
        self.assertEqual(await self._state(), "never")

    async def test_an_earlier_round_that_ended_without_a_pass_needs_a_new_call(self):
        for pairs in ((("cancelled", None),), (("failed", None), ("cancelled", None)), (("completed", "fail"),), (("completed", "needs_review"),)):
            self.assertEqual(await self._state(*pairs), "fresh", pairs)

    async def test_a_call_on_its_way_or_a_pass_means_nothing_to_redo(self):
        for pair in (("pending", None), ("initiated", None), ("in_progress", None), ("completed", "pass")):
            self.assertEqual(await self._state(("cancelled", None), pair), "busy", pair)


class ApprovalDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def _approve(self, *, state):
        svc = ShortlistService(AsyncMock())
        svc._session.get = AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4(), voice_screening_enabled=True))
        record = SimpleNamespace(job_id=uuid.uuid4(), candidate_id=uuid.uuid4())
        dispatch = AsyncMock(return_value=(1, 0, []))
        auto = AsyncMock(return_value=(1, 0))
        with patch("app.services.settings_service.load_system_settings", AsyncMock(return_value=SimpleNamespace())), \
             patch("app.services.celery_health.celery_workers_available_async", AsyncMock(return_value=True)), \
             patch("app.services.call_window_service.is_within_call_window", return_value=True), \
             patch("app.services.screening_trigger_service.call_state_on_approval", AsyncMock(return_value=state)), \
             patch("app.services.screening_trigger_service.dispatch_screening_for_candidates", dispatch), \
             patch("app.services.screening_trigger_service.auto_dispatch_unqueued_approved_for_job", auto):
            await svc._handle_approval_side_effects(SimpleNamespace(tenant_id=uuid.uuid4()), record)
        return dispatch, auto, record

    async def test_never_called_uses_the_usual_auto_dispatch(self):
        dispatch, auto, _ = await self._approve(state="never")
        auto.assert_awaited_once()
        dispatch.assert_not_awaited()

    async def test_approved_again_after_a_cancelled_round_gets_its_own_call(self):
        dispatch, auto, record = await self._approve(state="fresh")
        auto.assert_not_awaited()
        dispatch.assert_awaited_once()
        self.assertEqual(dispatch.await_args.args[2], [record.candidate_id])
        self.assertFalse(dispatch.await_args.kwargs["respect_cancel"])  # the cancel was the old round

    async def test_approved_again_while_a_call_is_on_its_way_does_nothing(self):
        dispatch, auto, _ = await self._approve(state="busy")
        dispatch.assert_not_awaited()
        auto.assert_not_awaited()


class SwitchRulesTests(unittest.IsolatedAsyncioTestCase):
    def test_the_phone_round_is_everyone_waiting_without_a_call_result(self):
        self.assertEqual(PHONE_ROUND_STATES, {"queued", "scheduled", "retrying", "flagged", "cancelled"})

    async def test_turning_off_with_people_waiting_needs_a_choice(self):
        db = AsyncMock()
        job = SimpleNamespace(id=uuid.uuid4(), voice_screening_enabled=True, title="J")
        r = MagicMock()
        r.scalars.return_value.one.return_value = job
        db.execute = AsyncMock(return_value=r)
        waiting = VoiceScreeningPreview(enabled=True, in_phone_round=[VoiceScreeningCandidate(candidate_id=uuid.uuid4(), name="Jane", state="queued")])
        with patch("app.services.voice_screening_service.get_tenant_job", AsyncMock(return_value=job)), \
             patch("app.services.voice_screening_service.classify_candidates", AsyncMock(return_value=waiting)):
            with self.assertRaises(ValidationError) as ctx:
                await VoiceScreeningService(db, audit_service=AsyncMock()).change(
                    SimpleNamespace(tenant_id=uuid.uuid4()), job.id, VoiceScreeningChange(enabled=False)
                )
        self.assertIn("1 candidate is waiting", ctx.exception.public_message)
        self.assertTrue(job.voice_screening_enabled)
        db.commit.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
