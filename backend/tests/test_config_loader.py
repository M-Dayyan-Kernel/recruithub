"""Tests for YAML config loader and facade."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pydantic import ValidationError

from app.core import config_loader
from app.core.config_loader import (
    AppConfig,
    load_config,
    resolve_config_path,
)
from app.core.settings import Settings


MINIMAL_YAML = """
models:
  resume_parse: { name: gpt-test-resume, temperature: 0, max_tokens: 100 }
  jd_parse: { name: gpt-test-jd, temperature: 0, max_tokens: 100 }
  shortlist: { name: gpt-test-shortlist, temperature: 0, max_tokens: 100 }
  combined_shortlist: { name: gpt-test-combined, temperature: 0, max_tokens: 3000 }
  expected_answer: { name: gpt-test-expected, temperature: 0, max_tokens: 100 }
  screening_extraction: { name: gpt-test-screening, temperature: 0, max_tokens: 100 }
  interview_assessment: { name: gpt-test-assessment, temperature: 0, max_tokens: 100 }
livekit:
  agent_name: test-agent
  llm: { name: gpt-test-llm }
  stt: { name: gpt-test-stt, realtime: true }
  tts: { name: tts-test, voice: alloy }
vapi:
  llm: { name: gpt-test-vapi }
  voice: { provider: deepgram, voice_id: test-voice }
  transcriber: { provider: deepgram, model: nova-test, language: en }
"""


class ConfigLoaderTests(unittest.TestCase):
    def tearDown(self) -> None:
        # Clear override first so reload restores the shipped YAML.
        os.environ.pop("CONFIG_PATH", None)
        load_config(reload=True)

    def test_default_path_resolves_beside_loader(self) -> None:
        os.environ.pop("CONFIG_PATH", None)
        path = resolve_config_path()
        self.assertTrue(path.exists(), msg=f"missing shipped config at {path}")
        self.assertEqual(path.name, "config.yaml")
        self.assertEqual(path.parent.name, "core")

    def test_shipped_config_loads_expected_models(self) -> None:
        cfg = load_config(reload=True)
        self.assertEqual(cfg.models.resume_parse.name, "gpt-4o")
        self.assertEqual(cfg.models.interview_assessment.name, "gpt-4o-mini")
        self.assertEqual(cfg.livekit.tts.voice, "nova")
        self.assertEqual(cfg.vapi.voice.voice_id, "asteria")
        self.assertEqual(cfg.vapi.transcriber.model, "nova-2")
        self.assertEqual(cfg.concurrency.max_parses, 10)
        self.assertTrue(cfg.DATABASE_URL)  # proxied from Settings

    def test_config_path_env_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "custom.yaml"
            path.write_text(MINIMAL_YAML, encoding="utf-8")
            os.environ["CONFIG_PATH"] = str(path)
            try:
                cfg = load_config(reload=True)
                self.assertEqual(cfg.models.resume_parse.name, "gpt-test-resume")
                self.assertEqual(cfg.livekit.agent_name, "test-agent")
                self.assertEqual(cfg.vapi.voice.voice_id, "test-voice")
            finally:
                os.environ.pop("CONFIG_PATH", None)

    def test_explicit_config_path_argument(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "arg.yaml"
            path.write_text(MINIMAL_YAML, encoding="utf-8")
            cfg = load_config(str(path), reload=True)
            self.assertEqual(cfg.models.shortlist.name, "gpt-test-shortlist")

    def test_missing_file_raises(self) -> None:
        missing = Path(tempfile.gettempdir()) / "does-not-exist-config.yaml"
        with self.assertRaises(FileNotFoundError):
            load_config(str(missing), reload=True)

    def test_invalid_yaml_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.yaml"
            path.write_text("models:\n  resume_parse: {}\n", encoding="utf-8")
            with self.assertRaises(ValidationError):
                load_config(str(path), reload=True)

    def test_extra_keys_forbidden(self) -> None:
        with self.assertRaises(ValidationError):
            AppConfig.model_validate(
                {
                    "models": {},
                    "unexpected": True,
                }
            )

    def test_startup_cache_reuses_instance(self) -> None:
        first = load_config(reload=True)
        second = load_config()
        self.assertIs(first, second)

    def test_reload_creates_new_instance(self) -> None:
        first = load_config(reload=True)
        second = load_config(reload=True)
        self.assertIsNot(first, second)
        self.assertEqual(first.models.resume_parse.name, second.models.resume_parse.name)

    def test_env_facade_uses_provided_settings(self) -> None:
        env = Settings(REDIS_URL="redis://test-cache:6379/9")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "env.yaml"
            path.write_text(MINIMAL_YAML, encoding="utf-8")
            cfg = load_config(str(path), reload=True, env=env)
            self.assertEqual(cfg.REDIS_URL, "redis://test-cache:6379/9")


class CallSiteConfigTests(unittest.TestCase):
    """Focused checks that call sites read configured model names."""

    def tearDown(self) -> None:
        load_config(reload=True)

    def test_resume_parser_uses_configured_model(self) -> None:
        from app.services import resume_parser

        captured: dict = {}

        class FakeCompletions:
            def create(self, **kwargs):
                captured.update(kwargs)

                class Choice:
                    message = type("M", (), {"content": '{"skills": []}'})()

                return type("R", (), {"choices": [Choice()]})()

        class FakeClient:
            def __init__(self, api_key: str):
                self.chat = type("C", (), {"completions": FakeCompletions()})()

        with mock.patch.object(resume_parser, "OpenAI", FakeClient):
            resume_parser._parse_resume_sync("x" * 80, "sk-test")

        self.assertEqual(captured["model"], config_loader.config.models.resume_parse.name)
        self.assertEqual(
            captured["max_tokens"],
            config_loader.config.models.resume_parse.max_tokens,
        )

    def test_assessment_uses_configured_model(self) -> None:
        import asyncio
        from app.services import assessment_service

        captured: dict = {}

        class FakeCompletions:
            async def create(self, **kwargs):
                captured.update(kwargs)

                class Choice:
                    message = type("M", (), {"content": "{}"})()

                return type("R", (), {"choices": [Choice()]})()

        class FakeAsyncOpenAI:
            def __init__(self, api_key: str):
                self.chat = type("C", (), {"completions": FakeCompletions()})()

        fake_openai = mock.MagicMock()
        fake_openai.AsyncOpenAI = FakeAsyncOpenAI
        with mock.patch.dict("sys.modules", {"openai": fake_openai}):
            asyncio.run(
                assessment_service._run_gpt_assessment("sys", "user", "sk-test")
            )

        self.assertEqual(
            captured["model"],
            config_loader.config.models.interview_assessment.name,
        )


if __name__ == "__main__":
    unittest.main()
