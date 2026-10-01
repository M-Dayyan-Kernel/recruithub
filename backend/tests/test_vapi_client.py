"""Unit tests for VapiClient."""

from __future__ import annotations

import asyncio
import unittest
from unittest import mock

from app.clients.vapi_client import VapiClient


class VapiClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_call_uses_mock_when_enabled(self) -> None:
        client = VapiClient()
        with mock.patch("app.clients.vapi_client.mocks.mock_vapi_enabled", return_value=True):
            result = await client.get_call("call-123")
        self.assertEqual(result["id"], "call-123")
        self.assertEqual(result["status"], "ended")

    async def test_get_call_fetches_via_http(self) -> None:
        client = VapiClient()

        class FakeResponse:
            status_code = 200

            def json(self):
                return {"id": "call-456", "status": "in-progress"}

        with mock.patch("app.clients.vapi_client.mocks.mock_vapi_enabled", return_value=False), mock.patch.object(
            client,
            "resolve_credentials",
            return_value=("sk-test", "phone-id"),
        ), mock.patch.object(
            client,
            "get_call_sync",
            return_value={"id": "call-456", "status": "in-progress"},
        ) as get_sync:
            result = await client.get_call("call-456")
            get_sync.assert_called_once()

        self.assertEqual(result["id"], "call-456")

    def test_create_outbound_call_sync_parses_id(self) -> None:
        client = VapiClient()

        class FakeResponse:
            status_code = 201

            def json(self):
                return {"id": "new-call-id"}

        with mock.patch("httpx.Client") as client_cls:
            instance = client_cls.return_value.__enter__.return_value
            instance.post.return_value = FakeResponse()
            call_id = client.create_outbound_call_sync({"type": "outboundPhoneCall"}, "sk-test")

        self.assertEqual(call_id, "new-call-id")


if __name__ == "__main__":
    unittest.main()
