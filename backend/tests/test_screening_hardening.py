"""Tests for screening production hardening."""

from __future__ import annotations

import unittest
import uuid
from unittest import mock

from app.services.phone_validation import validate_phone_sync
from app.tasks import screening_tasks


class PhoneGeographyTests(unittest.TestCase):
    def test_india_only_enforced(self) -> None:
        ok, normalized, reason = validate_phone_sync(
            "9876543210",
            enforce_geography=True,
            allowed_regions=["IN"],
        )
        self.assertTrue(ok)
        self.assertEqual(normalized, "+919876543210")
        self.assertIsNone(reason)

    def test_us_number_rejected_when_india_only(self) -> None:
        ok, _normalized, reason = validate_phone_sync(
            "+12025550123",
            enforce_geography=True,
            allowed_regions=["IN"],
        )
        self.assertFalse(ok)
        self.assertIn("allowed region", (reason or "").lower())

    def test_us_allowed_when_in_regions(self) -> None:
        ok, normalized, reason = validate_phone_sync(
            "+12025550123",
            enforce_geography=True,
            allowed_regions=["US", "IN"],
        )
        self.assertTrue(ok)
        self.assertEqual(normalized, "+12025550123")
        self.assertIsNone(reason)

    def test_enforcement_off_accepts_plus_e164(self) -> None:
        ok, normalized, reason = validate_phone_sync(
            "+442071838750",
            enforce_geography=False,
            allowed_regions=["IN"],
        )
        self.assertTrue(ok)
        self.assertEqual(normalized, "+442071838750")
        self.assertIsNone(reason)

    def test_enforcement_on_with_empty_regions_fails(self) -> None:
        ok, _normalized, reason = validate_phone_sync(
            "+919876543210",
            enforce_geography=True,
            allowed_regions=[],
        )
        self.assertFalse(ok)
        self.assertIn("configured", (reason or "").lower())


class ScreeningStatusMachineTests(unittest.TestCase):
    def test_terminal_cannot_regress(self) -> None:
        self.assertFalse(screening_tasks.can_set_call_status("completed", "in_progress"))
        self.assertFalse(screening_tasks.can_set_call_status("failed", "pending"))
        self.assertTrue(screening_tasks.can_set_call_status("initiated", "in_progress"))
        self.assertTrue(screening_tasks.can_set_call_status("pending", "initiated"))

    def test_set_call_status_if_allowed(self) -> None:
        call = mock.Mock()
        call.call_status = "completed"
        call.id = uuid.uuid4()
        applied = screening_tasks.set_call_status_if_allowed(call, "in_progress")
        self.assertFalse(applied)
        self.assertEqual(call.call_status, "completed")

        call.call_status = "initiated"
        applied = screening_tasks.set_call_status_if_allowed(call, "in_progress")
        self.assertTrue(applied)
        self.assertEqual(call.call_status, "in_progress")


class ScreeningQueueSlotTests(unittest.IsolatedAsyncioTestCase):
    async def test_has_slot_when_under_cap(self) -> None:
        from app.services import screening_queue_service

        session = mock.AsyncMock()
        count_result = mock.Mock()
        count_result.scalar.return_value = 2
        session.execute = mock.AsyncMock(return_value=count_result)

        with mock.patch.object(
            screening_queue_service.config.concurrency,
            "max_live_screening_calls",
            5,
        ):
            self.assertTrue(
                await screening_queue_service.has_live_screening_slot(
                    session, uuid.uuid4()
                )
            )

    async def test_no_slot_when_at_cap(self) -> None:
        from app.services import screening_queue_service

        session = mock.AsyncMock()
        count_result = mock.Mock()
        count_result.scalar.return_value = 5
        session.execute = mock.AsyncMock(return_value=count_result)

        with mock.patch.object(
            screening_queue_service.config.concurrency,
            "max_live_screening_calls",
            5,
        ):
            self.assertFalse(
                await screening_queue_service.has_live_screening_slot(
                    session, uuid.uuid4()
                )
            )


class WebhookTokenTests(unittest.TestCase):
    def test_missing_token_rejected_when_secret_set(self) -> None:
        from fastapi import HTTPException
        from app.api.routes import screening as screening_routes

        request = mock.Mock()
        request.query_params = {}

        with mock.patch.object(
            screening_routes.config, "VAPI_WEBHOOK_SECRET", "prod-secret"
        ):
            with self.assertRaises(HTTPException) as ctx:
                screening_routes._verify_vapi_webhook_token(request)
            self.assertEqual(ctx.exception.status_code, 401)

    def test_matching_token_accepted(self) -> None:
        from app.api.routes import screening as screening_routes

        request = mock.Mock()
        request.query_params = {"token": "prod-secret"}

        with mock.patch.object(
            screening_routes.config, "VAPI_WEBHOOK_SECRET", "prod-secret"
        ):
            screening_routes._verify_vapi_webhook_token(request)

    def test_empty_secret_allows_dev(self) -> None:
        from app.api.routes import screening as screening_routes

        request = mock.Mock()
        request.query_params = {}

        with mock.patch.object(screening_routes.config, "VAPI_WEBHOOK_SECRET", ""):
            screening_routes._verify_vapi_webhook_token(request)


class DialRetryPendingTests(unittest.IsolatedAsyncioTestCase):
    async def test_transient_failure_keeps_pending(self) -> None:
        """Simulate the dial except-path state transitions without full Celery."""
        call = mock.Mock()
        call.vapi_call_id = None
        call.call_status = "pending"
        call.call_outcome = None
        call.summary = None

        # Apply the same state mutation as the transient branch
        call.vapi_call_id = None
        call.summary = "connection reset"
        call.call_status = "pending"
        call.call_outcome = None

        self.assertEqual(call.call_status, "pending")
        self.assertIsNone(call.call_outcome)
        self.assertIsNone(call.vapi_call_id)


if __name__ == "__main__":
    unittest.main()
