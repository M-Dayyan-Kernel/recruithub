"""Tests for screening_enabled setting and gates."""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.settings_service import CachedSettings, _defaults, _settings_from_row


class ScreeningEnabledSettingsTests(unittest.TestCase):
    def test_defaults_include_screening_enabled(self):
        cached = _defaults()
        self.assertTrue(cached.screening_enabled)

    def test_settings_from_row_reads_screening_enabled(self):
        row = MagicMock()
        row.allowed_phone_regions = ["IN"]
        row.enforce_phone_geography = True
        row.screening_enabled = False
        row.screening_max_retries = 3
        row.screening_retry_delay_seconds = 1800

        cached = _settings_from_row(row, fetched_at=_defaults().fetched_at)
        self.assertFalse(cached.screening_enabled)

    def test_settings_from_row_defaults_when_column_missing(self):
        row = MagicMock(spec=["allowed_phone_regions", "enforce_phone_geography", "screening_max_retries", "screening_retry_delay_seconds"])
        row.allowed_phone_regions = ["IN"]
        row.enforce_phone_geography = True
        row.screening_max_retries = 3
        row.screening_retry_delay_seconds = 1800

        cached = _settings_from_row(row, fetched_at=_defaults().fetched_at)
        self.assertTrue(cached.screening_enabled)


class DispatchScreeningGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_dispatch_skipped_when_screening_disabled(self):
        from app.services.screening_trigger_service import dispatch_screening_for_candidates

        job = MagicMock()
        job.id = "job-id"

        disabled = CachedSettings(
            allowed_phone_regions=["IN"],
            enforce_phone_geography=True,
            screening_enabled=False,
            screening_max_retries=3,
            screening_retry_delay_seconds=1800,
            fetched_at=_defaults().fetched_at,
        )

        db = AsyncMock()
        with patch(
            "app.services.screening_trigger_service.load_system_settings",
            AsyncMock(return_value=disabled),
        ):
            initiated, queued, skipped = await dispatch_screening_for_candidates(
                db,
                job,
                ["candidate-id"],
            )

        self.assertEqual(initiated, 0)
        self.assertEqual(queued, 0)
        self.assertEqual(len(skipped), 1)
        self.assertIn("disabled", skipped[0]["reason"].lower())


if __name__ == "__main__":
    unittest.main()
