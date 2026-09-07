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
  jd_parse: { name: gpt-test-jd, temperature: 0, max_tokens: 100 }
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
        self.assertEqual(cfg.models.combined_shortlist.name, "gpt-5.4-mini")
        self.assertEqual(cfg.models.interview_assessment.name, "gpt-5.4-mini")
        self.assertEqual(cfg.livekit.tts.voice, "nova")
        self.assertEqual(cfg.vapi.voice.voice_id, "asteria")
        self.assertEqual(cfg.vapi.transcriber.model, "nova-2")
        self.assertEqual(cfg.concurrency.max_shortlists, 30)
        self.assertEqual(cfg.logging.level, "INFO")
        self.assertEqual(cfg.logging.format, "text")
        self.assertEqual(cfg.logging.dir, "logs")
        self.assertEqual(cfg.logging.max_bytes, 10485760)
        self.assertEqual(cfg.logging.backup_count, 5)
        self.assertTrue(cfg.DATABASE_URL)

    def test_config_path_env_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "custom.yaml"
            path.write_text(MINIMAL_YAML, encoding="utf-8")
            os.environ["CONFIG_PATH"] = str(path)
            try:
                cfg = load_config(reload=True)
                self.assertEqual(cfg.models.combined_shortlist.name, "gpt-test-combined")
                self.assertEqual(cfg.livekit.agent_name, "test-agent")
                self.assertEqual(cfg.vapi.voice.voice_id, "test-voice")
            finally:
                os.environ.pop("CONFIG_PATH", None)

    def test_explicit_config_path_argument(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "arg.yaml"
            path.write_text(MINIMAL_YAML, encoding="utf-8")
            cfg = load_config(str(path), reload=True)
            self.assertEqual(cfg.models.jd_parse.name, "gpt-test-jd")

    def test_missing_file_raises(self) -> None:
        missing = Path(tempfile.gettempdir()) / "does-not-exist-config.yaml"
        with self.assertRaises(FileNotFoundError):
            load_config(str(missing), reload=True)

    def test_invalid_yaml_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.yaml"
            path.write_text("models:\n  jd_parse: {}\n", encoding="utf-8")
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
        self.assertEqual(
            first.models.combined_shortlist.name,
            second.models.combined_shortlist.name,
        )

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

    def test_combined_shortlist_uses_configured_model(self) -> None:
        from app.services import combined_shortlist_service

        captured: dict = {}

        class FakeOpenAIClient:
            def chat_completion_json_sync(self, workload, messages, *, api_key):
                captured["workload"] = workload
                captured["api_key"] = api_key
                return (
                    '{"profile":{"name":"A","email":null,"phone":null,'
                    '"skills":[],"total_experience_years":0,"experience":[],'
                    '"education":[],"current_company":null,"current_role":null},'
                    '"assessment":{"match_score":50,"recommendation":"review",'
                    '"strengths":[],"gaps":[],"reason":"ok"}}'
                )

        with mock.patch(
            "app.services.combined_shortlist_service.openai_client",
            return_value=FakeOpenAIClient(),
        ):
            combined_shortlist_service._combined_shortlist_sync(
                "x" * 80,
                {"title": "Engineer", "description": "Build things"},
                "sk-test",
            )

        self.assertEqual(captured["workload"], "combined_shortlist")
        self.assertEqual(captured["api_key"], "sk-test")

    def test_assessment_uses_configured_model(self) -> None:
        import asyncio
        from app.services import assessment_service

        captured: dict = {}

        class FakeOpenAIClient:
            async def chat_completion_json(self, workload, messages, *, api_key):
                captured["workload"] = workload
                captured["api_key"] = api_key
                return "{}"

        with mock.patch(
            "app.services.assessment_service.openai_client",
            return_value=FakeOpenAIClient(),
        ):
            asyncio.run(
                assessment_service._run_gpt_assessment("sys", "user", "sk-test")
            )

        self.assertEqual(captured["workload"], "interview_assessment")
        self.assertEqual(captured["api_key"], "sk-test")


if __name__ == "__main__":
    unittest.main()
