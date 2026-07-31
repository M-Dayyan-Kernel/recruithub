from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # development | production — production triggers fail-fast validation at startup
    APP_ENV: str = "development"
    # Comma-separated allowed browser origins (required in production)
    CORS_ORIGINS: str = ""
    # Comma-separated hosts for TrustedHostMiddleware (optional)
    TRUSTED_HOSTS: str = ""

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ai_recruitment"
    REDIS_URL: str = "redis://localhost:6379"

    # Mock mode — skip paid external APIs during local dev (see MOCK_MODE.md)
    MOCK_EXTERNAL_APIS: bool = False
    MOCK_OPENAI: bool = False
    MOCK_VAPI: bool = False
    MOCK_LIVEKIT: bool = False
    MOCK_EMAIL: bool = False

    OPENAI_API_KEY: str = ""
    OPENAI_TIMEOUT_SECONDS: float = 60.0
    VAPI_API_KEY: str = ""
    VAPI_PHONE_NUMBER_ID: str = ""
    # Shared secret appended as ?token= on Vapi serverUrl webhooks (empty = permissive in dev).
    VAPI_WEBHOOK_SECRET: str = ""
    # Public HTTPS base URL for webhooks (e.g. ngrok tunnel). Enables Vapi call status updates.
    BACKEND_PUBLIC_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""
    LIVEKIT_URL: str = ""

    # Linode Object Storage (S3-compatible) — LiveKit egress recording uploads
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

    # Resend (optional — used when Gmail OAuth is not configured)
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

    # Logging — DEBUG | INFO | WARNING | ERROR; LOG_FORMAT=text|json
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "text"

    # Optional observability
    SENTRY_DSN: str = ""
    INTERNAL_HEALTH_API_KEY: str = ""

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


settings = Settings()
