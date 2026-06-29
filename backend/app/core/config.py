from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ai_recruitment"
    REDIS_URL: str = "redis://localhost:6379"

    OPENAI_API_KEY: str = ""
    VAPI_API_KEY: str = ""
    VAPI_PHONE_NUMBER_ID: str = ""
    SARVAM_API_KEY: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""
    LIVEKIT_URL: str = ""
    RESEND_API_KEY: str = ""
    CANDIDATE_APP_URL: str = "http://localhost:5174"

    UPLOAD_DIR: str = "uploads/resumes"

    GOOGLE_DRIVE_API_KEY: str = ""
    # Service-account JSON string for Drive API access.
    # Set the full JSON contents (not a path) as the env var value.
    GOOGLE_DRIVE_CREDENTIALS_JSON: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
