import logging
import os

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Settings fields the app pulls from OpenBao at startup (comma-separated).
# Override with BAO_SECRET_KEYS. OpenBao values win over .env.
_DEFAULT_BAO_KEYS = (
    "OPENAI_API_KEY,GROQ_API_KEY,VAPI_API_KEY,VAPI_WEBHOOK_SECRET,"
    "LIVEKIT_API_KEY,LIVEKIT_API_SECRET,S3_ACCESS_KEY,S3_SECRET_KEY,"
    "GMAIL_CREDENTIALS_JSON,GMAIL_TOKEN_JSON,RESEND_API_KEY,"
    "JWT_SECRET_KEY,INTEGRATIONS_ENCRYPTION_KEY,TALENTOS_BE_API_KEY,"
    "INTERNAL_HEALTH_API_KEY,AIC_API_KEY,SEED_ADMIN_PASSWORD,SEED_SUPERADMIN_PASSWORD,"
    "APP_ENV,DATABASE_URL,REDIS_URL,CORS_ORIGINS,LLM_PROVIDER,GROQ_BASE_URL,"
    "VAPI_PHONE_NUMBER_ID,LIVEKIT_URL,CANDIDATE_APP_URL,HR_APP_URL,"
    "JWT_ALGORITHM,JWT_EXPIRE_MINUTES,SEED_ADMIN_EMAIL,SEED_ADMIN_NAME,"
    "SEED_SUPERADMIN_EMAIL,SEED_SUPERADMIN_NAME,UPLOAD_DIR,S3_ENDPOINT,S3_REGION,"
    "S3_BUCKET,S3_FORCE_PATH_STYLE,MOCK_EXTERNAL_APIS,MOCK_OPENAI,MOCK_VAPI,"
    "MOCK_EMAIL,MOCK_LIVEKIT,TALENTOS_BE_URL"
)


class Settings(BaseSettings):
    # development | production ΓÇö production triggers fail-fast validation at startup
    APP_ENV: str = "development"
    # Comma-separated allowed browser origins (required in production)
    CORS_ORIGINS: str = ""
    # Comma-separated hosts for TrustedHostMiddleware (optional)
    TRUSTED_HOSTS: str = ""

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ai_recruitment"
    REDIS_URL: str = "redis://localhost:6379"

    # Mock mode ΓÇö skip paid external APIs during local dev (see MOCK_MODE.md)
    MOCK_EXTERNAL_APIS: bool = False
    MOCK_OPENAI: bool = False
    MOCK_VAPI: bool = False
    MOCK_LIVEKIT: bool = False
    MOCK_EMAIL: bool = False

    # LLM provider switch: "openai" | "groq" (Groq is OpenAI-compatible)
    LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str = ""
    OPENAI_TIMEOUT_SECONDS: float = 60.0
    # Groq credentials (used when LLM_PROVIDER=groq)
    GROQ_API_KEY: str = ""
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    VAPI_API_KEY: str = ""
    VAPI_PHONE_NUMBER_ID: str = ""
    # Shared secret appended as ?token= on Vapi serverUrl webhooks (empty = permissive in dev).
    VAPI_WEBHOOK_SECRET: str = ""
    # Public HTTPS base URL for webhooks (e.g. ngrok tunnel). Enables Vapi call status updates.
    BACKEND_PUBLIC_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""
    LIVEKIT_URL: str = ""

    # Linode Object Storage (S3-compatible) ΓÇö LiveKit egress recording uploads
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_ENDPOINT: str = "https://in-maa-1.linodeobjects.com"
    S3_REGION: str = "in-maa-1"
    S3_BUCKET: str = ""
    S3_FORCE_PATH_STYLE: bool = True

    CANDIDATE_APP_URL: str = "http://localhost:5174"
    HR_APP_URL: str = "http://localhost:5173"

    GMAIL_CREDENTIALS_PATH: str = "credentials.json"
    GMAIL_TOKEN_PATH: str = "token.json"
    # Optional inline OAuth JSON (preferred in Docker/production over file paths)
    GMAIL_CREDENTIALS_JSON: str = ""
    GMAIL_TOKEN_JSON: str = ""

    # Resend (optional ΓÇö used when Gmail OAuth is not configured)
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "onboarding@resend.dev"

    # Local filesystem fallbacks when S3 is not configured (paths, not size limits)
    UPLOAD_DIR: str = "uploads/resumes"
    ORG_DOCS_DIR: str = "uploads/org-docs"

    # JWT auth / RBAC
    JWT_SECRET_KEY: str = "change-me-in-production-use-a-long-random-string"
    # Master key for system_settings.integrations Fernet secrets (falls back to JWT_SECRET_KEY)
    INTEGRATIONS_ENCRYPTION_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480
    SEED_ADMIN_EMAIL: str = ""
    SEED_ADMIN_PASSWORD: str = ""
    SEED_ADMIN_NAME: str = "Admin"
    SEED_SUPERADMIN_EMAIL: str = ""
    SEED_SUPERADMIN_PASSWORD: str = ""
    SEED_SUPERADMIN_NAME: str = "Super Admin"

    # Optional observability
    SENTRY_DSN: str = ""
    INTERNAL_HEALTH_API_KEY: str = ""

    # OpenBao (central secrets manager). When BAO_ADDR + a token are present,
    # the _DEFAULT_BAO_KEYS secrets are fetched from OpenBao at startup and
    # override the .env values. In local dev leave BAO_ADDR empty to fall back
    # to environment values.
    BAO_ADDR: str = ""
    BAO_TOKEN: str = ""
    BAO_TOKEN_FILE: str = ""
    BAO_KV_MOUNT: str = "secret"
    BAO_KV_PATH: str = "recruithub"
    BAO_REQUIRED: bool = False
    BAO_SECRET_KEYS: str = ""

    # talentOS Backend API
    TALENTOS_BE_URL: str = ""
    TALENTOS_BE_API_KEY: str = ""

    # Auth rate limits (per IP per window)
    AUTH_RATE_LIMIT_PER_MINUTE: int = 20
    AUTH_LOCKOUT_MAX_FAILURES: int = 10
    AUTH_LOCKOUT_SECONDS: int = 900

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def is_production(self) -> bool:
        return (self.APP_ENV or "development").strip().lower() == "production"


# Load the local .env into the environment so the OpenBao bootstrap vars
# (BAO_ADDR / BAO_TOKEN_FILE) are visible before Settings() is built.
load_dotenv()


def _inject_openbao_secrets() -> None:
    """Fetch secrets from OpenBao and inject them into os.environ.

    Runs BEFORE ``Settings()`` is constructed so settings resolve from OpenBao
    exactly like env vars. OpenBao values win over .env. No-op when BAO_ADDR is
    empty (local dev without OpenBao).
    """
    addr = os.environ.get("BAO_ADDR", "").strip()
    if not addr:
        return

    # Local import: avoids a circular import (settings -> openbao -> settings).
    from app.core.openbao import fetch_secrets

    secret_keys = os.environ.get("BAO_SECRET_KEYS", "").strip()
    key_list = secret_keys.split(",") if secret_keys else _DEFAULT_BAO_KEYS
    keys = [k.strip() for k in key_list.split(",") if k.strip()]
    fetched = fetch_secrets(keys)
    if not fetched and os.environ.get("BAO_REQUIRED", "").lower() in ("1", "true", "yes"):
        raise RuntimeError(
            f"OpenBao is required (BAO_REQUIRED=true) but no secrets could be fetched from {addr}"
        )
    for key, value in fetched.items():
        os.environ[key] = value
    if fetched:
        logger.info("Loaded %d/%d secrets from OpenBao at %s", len(fetched), len(keys), addr)
    else:
        logger.warning("No secrets loaded from OpenBao at %s ΓÇö using environment values", addr)


_inject_openbao_secrets()

settings = Settings()
