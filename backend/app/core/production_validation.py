"""Fail-fast validation when APP_ENV=production."""

from __future__ import annotations

from app.core.settings import Settings

_DEFAULT_JWT_SECRET = "change-me-in-production-use-a-long-random-string"
_MIN_JWT_SECRET_LEN = 32


def _is_s3_configured(env: Settings) -> bool:
    return bool(
        env.S3_BUCKET.strip()
        and env.S3_ACCESS_KEY.strip()
        and env.S3_SECRET_KEY.strip()
        and env.S3_ENDPOINT.strip()
    )


def validate_production_settings(env: Settings) -> None:
    """Raise ValueError listing all production misconfiguration issues."""
    if (env.APP_ENV or "development").strip().lower() != "production":
        return

    errors: list[str] = []

    jwt = (env.JWT_SECRET_KEY or "").strip()
    if not jwt or jwt == _DEFAULT_JWT_SECRET or len(jwt) < _MIN_JWT_SECRET_LEN:
        errors.append(
            f"JWT_SECRET_KEY must be set to a random string of at least "
            f"{_MIN_JWT_SECRET_LEN} characters (not the default)"
        )

    if not (env.INTEGRATIONS_ENCRYPTION_KEY or "").strip():
        errors.append("INTEGRATIONS_ENCRYPTION_KEY is required in production")

    if not (env.VAPI_WEBHOOK_SECRET or "").strip():
        errors.append("VAPI_WEBHOOK_SECRET is required in production")

    if not (env.LIVEKIT_API_KEY or "").strip() or not (env.LIVEKIT_API_SECRET or "").strip():
        errors.append("LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required in production")

    if (env.LLM_PROVIDER or "openai").strip().lower() == "groq" and not (
        env.GROQ_API_KEY or ""
    ).strip():
        errors.append(
            "GROQ_API_KEY is required in production when LLM_PROVIDER=groq"
        )

    if not _is_s3_configured(env):
        errors.append(
            "S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_ENDPOINT are required in production"
        )

    if env.MOCK_EXTERNAL_APIS or env.MOCK_OPENAI or env.MOCK_VAPI or env.MOCK_LIVEKIT or env.MOCK_EMAIL:
        errors.append("MOCK_* flags must be false in production")

    cors = (env.CORS_ORIGINS or "").strip()
    if not cors:
        errors.append("CORS_ORIGINS must list at least one allowed frontend origin")

    if not (env.BACKEND_PUBLIC_URL or "").strip():
        errors.append("BACKEND_PUBLIC_URL is required in production (webhooks)")

    if errors:
        bullet = "\n  - "
        raise ValueError(
            "Production environment validation failed:" + bullet + bullet.join(errors)
        )


def parse_csv_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def resolve_cors_origins(env: Settings) -> list[str]:
    """Production uses CORS_ORIGINS only; dev falls back to app URLs + localhost."""
    explicit = parse_csv_list(env.CORS_ORIGINS)
    if explicit:
        return explicit

    if (env.APP_ENV or "development").strip().lower() == "production":
        return []

    defaults = {
        env.HR_APP_URL,
        env.CANDIDATE_APP_URL,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5178",
        "http://127.0.0.1:5173",
    }
    return sorted({u.strip() for u in defaults if u and u.strip()})
