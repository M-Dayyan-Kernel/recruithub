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
            def __init__(self, api_key: str, timeout: float, **kwargs):
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
            config_loader.config.model_name("combined_shortlist"),
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
            def __init__(self, api_key: str, timeout: float, **kwargs):
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
            config_loader.config.model_name("interview_assessment"),
        )

    def test_unknown_workload_raises(self) -> None:
        client = OpenAIClient()
        with self.assertRaises(ValueError):
            client.chat_completion_json_sync(
                "not_a_workload",
                [{"role": "user", "content": "hi"}],
                api_key="sk-test",
            )

    def test_groq_switch_uses_groq_model_and_credentials(self) -> None:
        captured: dict = {}

        class FakeCompletions:
            def create(self, **kwargs):
                captured.update(kwargs)

                class Choice:
                    message = type("M", (), {"content": "{}"})()

                return type("R", (), {"choices": [Choice()]})()

        class FakeClient:
            def __init__(self, api_key, timeout, **kwargs):
                captured["client_api_key"] = api_key
                captured["schema_name"] = kwargs.get("schema_name")
                self.chat = type("C", (), {"completions": FakeCompletions()})()

        cfg = config_loader.load_config(reload=True)
        with mock.patch.object(
            config_loader,
            "_env_settings",
            config_loader.Settings(LLM_PROVIDER="groq", GROQ_API_KEY="gsk-test-key"),
        ):
            cfg = config_loader.load_config(reload=True)
            client = OpenAIClient(timeout_seconds=30.0)
            with mock.patch("app.clients.openai_client.OpenAI", FakeClient):
                content = client.chat_completion_json_sync(
                    "combined_shortlist",
                    [{"role": "user", "content": "hi"}],
                    api_key="should-be-ignored",
                )

        self.assertEqual(content, "{}")
        self.assertEqual(
            captured["model"],
            cfg.model_name("combined_shortlist"),
        )
        self.assertEqual(
            captured["model"], "llama-3.3-70b-versatile"
        )
        self.assertEqual(captured["client_api_key"], "gsk-test-key")

    def test_openai_mode_ignores_groq_key(self) -> None:
        captured: dict = {}

        class FakeCompletions:
            def create(self, **kwargs):
                captured.update(kwargs)

                class Choice:
                    message = type("M", (), {"content": "{}"})()

                return type("R", (), {"choices": [Choice()]})()

        class FakeClient:
            def __init__(self, api_key, timeout, **kwargs):
                captured["client_api_key"] = api_key
                self.chat = type("C", (), {"completions": FakeCompletions()})()

        config_loader.load_config(reload=True)
        with mock.patch.object(
            config_loader,
            "_env_settings",
            config_loader.Settings(LLM_PROVIDER="openai", GROQ_API_KEY="gsk-test-key"),
        ):
            cfg = config_loader.load_config(reload=True)
            client = OpenAIClient(timeout_seconds=30.0)
            with mock.patch("app.clients.openai_client.OpenAI", FakeClient):
                content = client.chat_completion_json_sync(
                    "combined_shortlist",
                    [{"role": "user", "content": "hi"}],
                    api_key="sk-tenant-openai",
                )

        self.assertEqual(captured["client_api_key"], "sk-tenant-openai")
        self.assertEqual(captured["model"], cfg.model_name("combined_shortlist"))
        self.assertEqual(captured["model"], "gpt-5.4-mini")


if __name__ == "__main__":
    unittest.main()
