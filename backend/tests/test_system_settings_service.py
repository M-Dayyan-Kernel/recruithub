"""System settings service/cache tests."""

import unittest
import uuid
from unittest.mock import MagicMock

from app.services.settings_cache_service import (
    SettingsCacheService,
    _defaults,
    settings_from_row,
)


class SystemSettingsServiceTests(unittest.TestCase):
    def test_defaults_screening_enabled(self):
        cached = _defaults()
        self.assertTrue(cached.screening_enabled)

    def test_settings_from_row_respects_screening_flag(self):
        row = MagicMock()
        row.tenant_id = uuid.uuid4()
        row.allowed_phone_regions = ["IN"]
        row.enforce_phone_geography = True
        row.screening_enabled = False
        row.screening_max_retries = 3
        row.screening_retry_delay_seconds = 1800

        cached = settings_from_row(row, fetched_at=_defaults().fetched_at, tenant_id=row.tenant_id)
        self.assertFalse(cached.screening_enabled)

    def test_cache_invalidate_clears_entry(self):
        tenant_id = uuid.uuid4()
        SettingsCacheService.invalidate()
        SettingsCacheService.invalidate(tenant_id)


if __name__ == "__main__":
    unittest.main()
