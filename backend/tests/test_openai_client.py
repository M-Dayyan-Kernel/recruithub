"""Unit tests for OpenAIClient."""

from __future__ import annotations

import asyncio
import unittest
from unittest import mock

from app.clients.openai_client import OpenAIClient
from app.core import config_loader


class OpenAIClientTests(unittest.TestCase):
    def tearDown(self) -> None:
        config_loader.load_config(reload=True)

    def test_sync_uses_configured_workload(self) -> None:
        captured: dict = {}

        class FakeCompletions:
            def create(self, **kwargs):
                captured.update(kwargs)

                class Choice:
                    message = type("M", (), {"content": "{}"})()

                return type("R", (), {"choices": [Choice()]})()

        class FakeClient:
            def __init__(self, api_key: str, timeout: float):
                self.chat = type("C", (), {"completions": FakeCompletions()})()

        client = OpenAIClient(timeout_seconds=30.0)
        with mock.patch("app.clients.openai_client.OpenAI", FakeClient):
            content = client.chat_completion_json_sync(
                "combined_shortlist",
                [{"role": "user", "content": "hi"}],
                api_key="sk-test",
            )

        self.assertEqual(content, "{}")
        self.assertEqual(
            captured["model"],
            config_loader.config.models.combined_shortlist.name,
        )
        self.assertEqual(
            captured["max_tokens"],
            config_loader.config.models.combined_shortlist.max_tokens,
        )

    def test_async_uses_configured_workload(self) -> None:
        captured: dict = {}

        class FakeCompletions:
            async def create(self, **kwargs):
                captured.update(kwargs)

                class Choice:
                    message = type("M", (), {"content": '{"ok": true}'})()

                return type("R", (), {"choices": [Choice()]})()

        class FakeAsyncClient:
            def __init__(self, api_key: str, timeout: float):
                self.chat = type("C", (), {"completions": FakeCompletions()})()

        client = OpenAIClient()
        with mock.patch("app.clients.openai_client.AsyncOpenAI", FakeAsyncClient):
            content = asyncio.run(
                client.chat_completion_json(
                    "interview_assessment",
                    [{"role": "user", "content": "hi"}],
                    api_key="sk-test",
                )
            )

        self.assertEqual(content, '{"ok": true}')
        self.assertEqual(
            captured["model"],
            config_loader.config.models.interview_assessment.name,
        )

    def test_unknown_workload_raises(self) -> None:
        client = OpenAIClient()
        with self.assertRaises(ValueError):
            client.chat_completion_json_sync(
                "not_a_workload",
                [{"role": "user", "content": "hi"}],
                api_key="sk-test",
            )


if __name__ == "__main__":
    unittest.main()
