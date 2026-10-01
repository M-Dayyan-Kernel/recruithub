"""ScreeningWebhookService tests."""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import InvalidWebhookTokenError
from app.services.screening_webhook_service import ScreeningWebhookService


class ScreeningWebhookServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_verify_token_raises_on_mismatch(self):
        session = AsyncMock()
        service = ScreeningWebhookService(session)
        request = MagicMock()
        request.query_params.get.return_value = "wrong-token"

        with patch("app.services.screening_webhook_service.config") as mock_config:
            mock_config.VAPI_WEBHOOK_SECRET = "expected-secret"
            with self.assertRaises(InvalidWebhookTokenError):
                service.verify_token(request)

    async def test_handle_event_returns_received_when_no_vapi_call_id(self):
        session = AsyncMock()
        service = ScreeningWebhookService(session)
        result = await service.handle_event({})
        self.assertEqual(result, {"status": "received"})

    async def test_handle_event_returns_duplicate_when_idempotency_claim_fails(self):
        session = AsyncMock()
        service = ScreeningWebhookService(session)

        with patch(
            "app.services.screening_webhook_service.claim_webhook_event_async",
            new_callable=AsyncMock,
            return_value=False,
        ):
            result = await service.handle_event(
                {"message": {"type": "status-update"}, "call": {"id": "call-1"}}
            )
        self.assertEqual(result, {"status": "duplicate"})


if __name__ == "__main__":
    unittest.main()
