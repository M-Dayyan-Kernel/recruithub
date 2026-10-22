"""The company name emails sign off with is not something an organisation admin can set."""

import unittest

from app.schemas.schemas import SystemSettingsUpdate


class CompanyNameIsNotAdminEditable(unittest.TestCase):
    def test_the_settings_update_has_no_company_name_field(self):
        self.assertNotIn("company_name", SystemSettingsUpdate.model_fields)

    def test_a_company_name_sent_to_the_settings_endpoint_is_dropped(self):
        # Hiding the field in the UI is not enough: PATCH /api/settings must ignore it too, or
        # one organisation could send emails that name another.
        payload = SystemSettingsUpdate.model_validate(
            {"company_name": "Some Other Company", "screening_enabled": False}
        )
        self.assertEqual(payload.model_dump(exclude_unset=True), {"screening_enabled": False})

    def test_the_other_settings_still_update(self):
        payload = SystemSettingsUpdate.model_validate(
            {
                "allowed_phone_regions": ["IN"],
                "enforce_phone_geography": True,
                "screening_enabled": True,
                "screening_max_retries": 3,
                "screening_retry_delay_seconds": 1800,
            }
        )
        self.assertEqual(len(payload.model_dump(exclude_unset=True)), 5)


if __name__ == "__main__":
    unittest.main()
