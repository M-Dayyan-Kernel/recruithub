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
        model_cfg = config_loader.config.models.combined_shortlist
        if model_cfg.name.lower().startswith(("o1", "o3", "o4", "gpt-5", "gpt-4.1", "gpt-4.5")):
            self.assertEqual(captured["max_completion_tokens"], model_cfg.max_tokens)
            self.assertNotIn("max_tokens", captured)
        else:
            self.assertEqual(captured["max_tokens"], model_cfg.max_tokens)

    def test_gpt5_workload_uses_max_completion_tokens(self) -> None:
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
            with mock.patch.object(
                client,
                "_model_config",
                return_value=type(
                    "Cfg",
                    (),
                    {
                        "name": "gpt-5.4-mini",
                        "temperature": 0,
                        "max_tokens": 3000,
                        "openai_response_format": lambda self: {"type": "json_object"},
                    },
                )(),
            ):
                client.chat_completion_json_sync(
                    "jd_parse",
                    [{"role": "user", "content": "hi"}],
                    api_key="sk-test",
                )

        self.assertNotIn("max_tokens", captured)
        self.assertEqual(captured["max_completion_tokens"], 3000)

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
        self.assertEqual(
            captured["max_completion_tokens"],
            config_loader.config.models.interview_assessment.max_tokens,
        )
        self.assertNotIn("max_tokens", captured)

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

    def test_errors_include_api_key_suffix(self) -> None:
        class FakeCompletions:
            def create(self, **kwargs):
                raise RuntimeError("boom")

        class FakeClient:
            def __init__(self, api_key: str, timeout: float):
                self.chat = type("C", (), {"completions": FakeCompletions()})()

        client = OpenAIClient(timeout_seconds=30.0)
        with mock.patch("app.clients.openai_client.OpenAI", FakeClient):
            with self.assertRaises(RuntimeError) as ctx:
                client.chat_completion_json_sync(
                    "jd_parse",
                    [{"role": "user", "content": "hi"}],
                    api_key="sk-proj-abcdefghij1234",
                )

        message = str(ctx.exception)
        self.assertIn("openai_api_key_suffix=...1234", message)
        self.assertIn("workload=jd_parse", message)
        self.assertNotIn("sk-proj-abcdefghij1234", message)


if __name__ == "__main__":
    unittest.main()
