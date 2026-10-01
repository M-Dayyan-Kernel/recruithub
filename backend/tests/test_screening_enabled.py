"""Tests for screening_enabled setting and gates."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.screening_gate_service import (
    BYPASS_SUMMARY_JOB,
    bypass_summary_for,
    is_voice_screening_effective,
    screening_disabled_reason,
)
from app.services.settings_service import CachedSettings, _defaults, _settings_from_row


def _settings(*, screening_enabled: bool = True) -> CachedSettings:
    tenant_id = uuid.uuid4()
    return CachedSettings(
        tenant_id=tenant_id,
        allowed_phone_regions=["IN"],
        enforce_phone_geography=True,
        screening_enabled=screening_enabled,
        screening_max_retries=3,
        screening_retry_delay_seconds=1800,
        fetched_at=_defaults().fetched_at,
    )


def _job(*, voice_screening_enabled: bool = True) -> MagicMock:
    job = MagicMock()
    job.id = uuid.uuid4()
    job.tenant_id = uuid.uuid4()
    job.voice_screening_enabled = voice_screening_enabled
    return job


class ScreeningEnabledSettingsTests(unittest.TestCase):
    def test_defaults_include_screening_enabled(self):
        cached = _defaults()
        self.assertTrue(cached.screening_enabled)

    def test_settings_from_row_reads_screening_enabled(self):
        row = MagicMock()
        row.tenant_id = uuid.uuid4()
        row.allowed_phone_regions = ["IN"]
        row.enforce_phone_geography = True
        row.screening_enabled = False
        row.screening_max_retries = 3
        row.screening_retry_delay_seconds = 1800

        cached = _settings_from_row(row, fetched_at=_defaults().fetched_at, tenant_id=row.tenant_id)
        self.assertFalse(cached.screening_enabled)

    def test_settings_from_row_defaults_when_column_missing(self):
        row = MagicMock(
            spec=[
                "tenant_id",
                "allowed_phone_regions",
                "enforce_phone_geography",
                "screening_max_retries",
                "screening_retry_delay_seconds",
            ]
        )
        row.tenant_id = uuid.uuid4()
        row.allowed_phone_regions = ["IN"]
        row.enforce_phone_geography = True
        row.screening_max_retries = 3
        row.screening_retry_delay_seconds = 1800

        cached = _settings_from_row(row, fetched_at=_defaults().fetched_at, tenant_id=row.tenant_id)
        self.assertTrue(cached.screening_enabled)


class VoiceScreeningEffectiveTests(unittest.TestCase):
    def test_global_off_job_on(self):
        settings = _settings(screening_enabled=False)
        job = _job(voice_screening_enabled=True)
        self.assertTrue(is_voice_screening_effective(settings, job))

    def test_global_on_job_on(self):
        settings = _settings(screening_enabled=True)
        job = _job(voice_screening_enabled=True)
        self.assertTrue(is_voice_screening_effective(settings, job))

    def test_global_on_job_off(self):
        settings = _settings(screening_enabled=True)
        job = _job(voice_screening_enabled=False)
        self.assertFalse(is_voice_screening_effective(settings, job))

    def test_global_off_job_off(self):
        settings = _settings(screening_enabled=False)
        job = _job(voice_screening_enabled=False)
        self.assertFalse(is_voice_screening_effective(settings, job))

    def test_screening_disabled_reason_only_when_job_off(self):
        settings = _settings(screening_enabled=False)
        job = _job(voice_screening_enabled=True)
        self.assertIsNone(screening_disabled_reason(settings, job))

    def test_screening_disabled_reason_job(self):
        settings = _settings(screening_enabled=True)
        job = _job(voice_screening_enabled=False)
        reason = screening_disabled_reason(settings, job)
        self.assertIn("this job", reason or "")

    def test_bypass_summary_for_job(self):
        settings = _settings(screening_enabled=False)
        job = _job(voice_screening_enabled=False)
        self.assertEqual(bypass_summary_for(settings, job), BYPASS_SUMMARY_JOB)


class DispatchScreeningGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_dispatch_skipped_when_job_voice_screening_disabled(self):
        from app.services.screening_trigger_service import dispatch_screening_for_candidates

        job = _job(voice_screening_enabled=False)
        settings = _settings(screening_enabled=True)

        db = AsyncMock()
        with patch(
            "app.services.settings_service.load_system_settings",
            AsyncMock(return_value=settings),
        ):
            initiated, queued, skipped = await dispatch_screening_for_candidates(
                db,
                job,
                ["candidate-id"],
            )

        self.assertEqual(initiated, 0)
        self.assertEqual(queued, 0)
        self.assertEqual(len(skipped), 1)
        self.assertIn("this job", skipped[0]["reason"].lower())

    async def test_dispatch_not_blocked_when_global_off_job_on(self):
        from app.services.screening_trigger_service import dispatch_screening_for_candidates

        job = _job(voice_screening_enabled=True)
        settings = _settings(screening_enabled=False)

        db = AsyncMock()
        cand_result = MagicMock()
        cand_result.scalars.return_value.first.return_value = None
        db.execute = AsyncMock(return_value=cand_result)

        with patch(
            "app.services.settings_service.load_system_settings",
            AsyncMock(return_value=settings),
        ):
            initiated, queued, skipped = await dispatch_screening_for_candidates(
                db,
                job,
                ["candidate-id"],
            )

        disabled = [s for s in skipped if "disabled" in s.get("reason", "").lower()]
        self.assertEqual(disabled, [])


if __name__ == "__main__":
    unittest.main()
