"""Production validation and rate limit tests."""

from __future__ import annotations

import unittest

from app.core.production_validation import validate_production_settings
from app.core.settings import Settings


class ProductionValidationTests(unittest.TestCase):
    def test_development_allows_default_jwt(self) -> None:
        env = Settings(APP_ENV="development")
        validate_production_settings(env)

    def test_production_rejects_weak_jwt(self) -> None:
        env = Settings(
            APP_ENV="production",
            JWT_SECRET_KEY="change-me-in-production-use-a-long-random-string",
            INTEGRATIONS_ENCRYPTION_KEY="x" * 44,
            VAPI_WEBHOOK_SECRET="secret",
            LIVEKIT_API_KEY="k",
            LIVEKIT_API_SECRET="s",
            S3_BUCKET="b",
            S3_ACCESS_KEY="a",
            S3_SECRET_KEY="s",
            CORS_ORIGINS="https://hr.example.com",
            BACKEND_PUBLIC_URL="https://api.example.com",
        )
        with self.assertRaises(ValueError):
            validate_production_settings(env)


class PasswordSchemaTests(unittest.TestCase):
    def test_password_strength(self) -> None:
        from app.schemas.schemas import validate_password_strength

        with self.assertRaises(ValueError):
            validate_password_strength("short")
        self.assertEqual(
            validate_password_strength("Str0ng!Password"),
            "Str0ng!Password",
        )


if __name__ == "__main__":
    unittest.main()
