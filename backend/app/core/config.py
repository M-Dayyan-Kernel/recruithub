from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/ai_recruitment"
    REDIS_URL: str = "redis://localhost:6379"

    # Mock mode — skip paid external APIs during local dev (see MOCK_MODE.md)
    MOCK_EXTERNAL_APIS: bool = False
    MOCK_OPENAI: bool = False
    MOCK_VAPI: bool = False
    MOCK_LIVEKIT: bool = False
    MOCK_EMAIL: bool = False

    OPENAI_API_KEY: str = ""
    VAPI_API_KEY: str = ""
    VAPI_PHONE_NUMBER_ID: str = ""
    # Public HTTPS base URL for webhooks (e.g. ngrok tunnel). Enables Vapi call status updates.
    BACKEND_PUBLIC_URL: str = ""
    SARVAM_API_KEY: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""
    LIVEKIT_URL: str = ""
    CANDIDATE_APP_URL: str = "http://localhost:5174"

    GMAIL_CREDENTIALS_PATH: str = "credentials.json"
    GMAIL_TOKEN_PATH: str = "token.json"

    UPLOAD_DIR: str = "uploads/resumes"
    MAX_CONCURRENT_PARSES: int = 10
    MAX_CONCURRENT_SHORTLISTS: int = 10
    MAX_ZIP_FILE_SIZE: int = 100 * 1024 * 1024  # 100 MB
    MAX_RESUMES_PER_ZIP: int = 200
    MAX_ZIP_UNCOMPRESSED_BYTES: int = 500 * 1024 * 1024  # 500 MB

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
