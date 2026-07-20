"""
Validated, startup-cached runtime configuration.

Non-secret tunables live in config.yaml (or CONFIG_PATH). Secrets and
deployment-specific values remain in Settings (.env) and are exposed through
the same facade so application code imports only this module.

YAML edits require restarting API, Celery, and interview-agent processes.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field

from app.core.settings import Settings, settings as _env_settings


# ---------------------------------------------------------------------------
# YAML schema (nested Pydantic models)
# ---------------------------------------------------------------------------


class ModelWorkloadConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = "openai"
    name: str
    temperature: float = 0
    max_tokens: int = 1000
    response_format: str = "json_object"

    def openai_response_format(self) -> dict[str, str]:
        return {"type": self.response_format}


class ModelsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resume_parse: ModelWorkloadConfig
    jd_parse: ModelWorkloadConfig
    shortlist: ModelWorkloadConfig
    combined_shortlist: ModelWorkloadConfig
    expected_answer: ModelWorkloadConfig
    screening_extraction: ModelWorkloadConfig
    interview_assessment: ModelWorkloadConfig


class LiveKitLlmConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = "openai"
    name: str


class LiveKitSttConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = "openai"
    name: str
    realtime: bool = True


class LiveKitTtsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = "openai"
    name: str
    voice: str


class LiveKitTurnHandlingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpointing_min_delay: float = 0.5
    preemptive_tts: bool = True
    interruption_enabled: bool = True


class NoiseCancellationConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    provider: str = "ai_coustics"
    model: str = "ROOK_S"


class LiveKitAudioConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    auto_gain_control: bool = True
    pre_connect_audio: bool = True
    pre_connect_timeout_seconds: float = 30.0
    noise_cancellation: NoiseCancellationConfig = Field(
        default_factory=NoiseCancellationConfig
    )


class LiveKitRoomConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    empty_timeout_seconds: int = 600
    max_participants: int = 10
    token_ttl_hours: int = 2


class LiveKitRecordingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    layout: str = "speaker"
    key_prefix: str = "recruitment-interview-recordings"


class LiveKitConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_name: str = "interview-agent"
    llm: LiveKitLlmConfig
    stt: LiveKitSttConfig
    tts: LiveKitTtsConfig
    turn_handling: LiveKitTurnHandlingConfig = Field(
        default_factory=LiveKitTurnHandlingConfig
    )
    audio: LiveKitAudioConfig = Field(default_factory=LiveKitAudioConfig)
    room: LiveKitRoomConfig = Field(default_factory=LiveKitRoomConfig)
    recording: LiveKitRecordingConfig = Field(default_factory=LiveKitRecordingConfig)


class VapiLlmConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = "openai"
    name: str


class VapiVoiceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = "deepgram"
    voice_id: str


class VapiTranscriberConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = "deepgram"
    model: str
    language: str = "en"


class VapiConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api_base: str = "https://api.vapi.ai"
    request_timeout_seconds: float = 30.0
    status_timeout_seconds: float = 5.0
    llm: VapiLlmConfig
    voice: VapiVoiceConfig
    transcriber: VapiTranscriberConfig
    first_message_mode: str = "assistant-speaks-first"
    background_sound: str = "office"
    silence_timeout_seconds: int = 20
    webhook_messages: list[str] = Field(
        default_factory=lambda: ["status-update", "end-of-call-report"]
    )


class ParsingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resume_max_chars: int = 8000
    jd_max_chars: int = 12000
    shortlist_jd_chars: int = 1200
    expected_answer_jd_chars: int = 2500
    expected_answer_max_points: int = 6
    screening_call_jd_chars: int = 500
    screening_transcript_chars: int = 12000
    assessment_transcript_chars: int = 14000
    assessment_jd_chars: int = 3000
    min_resume_chars: int = 50
    min_jd_chars: int = 50
    min_transcript_chars: int = 100
    default_question_score: int = 10


class ConcurrencyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_parses: int = 10
    max_shortlists: int = 10
    max_resume_processing: int = 10
    stuck_parse_timeout_minutes: int = 5
    shortlist_batch_ttl_seconds: int = 600


class UploadsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resume_max_bytes: int = 20 * 1024 * 1024
    jd_max_bytes: int = 20 * 1024 * 1024
    org_doc_max_bytes: int = 10 * 1024 * 1024
    zip_max_bytes: int = 100 * 1024 * 1024
    zip_max_uncompressed_bytes: int = 500 * 1024 * 1024
    max_resumes_per_zip: int = 200
    max_zip_nesting_depth: int = 5


class ScreeningPollConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    initial_delay_sec: int = 0
    interval_sec: int = 2
    max_polls: int = 60
    status_timeout_sec: float = 4.0


class TranscriptEnrichConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_attempts: int = 8
    delay_sec: int = 5
    failed_email_extra_delay_sec: int = 15


class ScreeningGraceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    live_call_sec: int = 12
    retry_call_sec: int = 20
    rapid_redial_guard_sec: int = 8


class ScreeningDefaultsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_retries: int = 3
    retry_delay_seconds: int = 1800


class ScreeningValidationConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min_retries: int = 1
    max_retries: int = 10
    min_retry_delay_seconds: int = 60
    max_retry_delay_seconds: int = 604800


class ScreeningConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    poll: ScreeningPollConfig = Field(default_factory=ScreeningPollConfig)
    transcript_enrich: TranscriptEnrichConfig = Field(
        default_factory=TranscriptEnrichConfig
    )
    grace: ScreeningGraceConfig = Field(default_factory=ScreeningGraceConfig)
    min_substantive_transcript_chars: int = 50
    defaults: ScreeningDefaultsConfig = Field(default_factory=ScreeningDefaultsConfig)
    validation: ScreeningValidationConfig = Field(
        default_factory=ScreeningValidationConfig
    )
    cache_ttl_seconds: int = 30
    redispatch_delay_sec: int = 15
    stale_active_call_minutes: int = 5

    @property
    def failed_email_delay_sec(self) -> int:
        enrich = self.transcript_enrich
        return (
            enrich.max_attempts * enrich.delay_sec + enrich.failed_email_extra_delay_sec
        )


class AssessmentRetryConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    delay_sec: int = 15
    max_attempts: int = 12


class InterviewConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_follow_ups_per_topic: int = 2
    thin_answer_word_limit: int = 25
    session_link_ttl_days: int = 7
    invite_ttl_days: int = 7
    assessment_retry: AssessmentRetryConfig = Field(
        default_factory=AssessmentRetryConfig
    )


class StoragePrefixesConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resumes: str = "recruitment-resume-storage/"
    gst: str = "recruitment-gst-files/"
    recordings: str = "recruitment-interview-recordings/"


class StorageConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    presign_expires_seconds: int = 3600
    prefixes: StoragePrefixesConfig = Field(default_factory=StoragePrefixesConfig)


class SchedulerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dispatch_pending_screening_seconds: float = 60.0
    recover_stuck_parses_seconds: float = 120.0


class CeleryRetryConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default_max_retries: int = 3
    rate_limit_countdown_sec: int = 300
    transient_countdown_sec: int = 120
    extraction_countdown_sec: int = 60


class AppConfig(BaseModel):
    """Typed non-secret configuration loaded from YAML."""

    model_config = ConfigDict(extra="forbid")

    models: ModelsConfig
    livekit: LiveKitConfig
    vapi: VapiConfig
    parsing: ParsingConfig = Field(default_factory=ParsingConfig)
    concurrency: ConcurrencyConfig = Field(default_factory=ConcurrencyConfig)
    uploads: UploadsConfig = Field(default_factory=UploadsConfig)
    screening: ScreeningConfig = Field(default_factory=ScreeningConfig)
    interview: InterviewConfig = Field(default_factory=InterviewConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    scheduler: SchedulerConfig = Field(default_factory=SchedulerConfig)
    celery: CeleryRetryConfig = Field(default_factory=CeleryRetryConfig)


# ---------------------------------------------------------------------------
# Path resolution + load
# ---------------------------------------------------------------------------


def _default_config_path() -> Path:
    """Shipped YAML sits beside this module: app/core/config.yaml."""
    return Path(__file__).resolve().parent / "config.yaml"


def _backend_root() -> Path:
    """backend/ — parent of the app package."""
    return Path(__file__).resolve().parents[2]


def resolve_config_path(config_path: str | None = None) -> Path:
    env_path = os.getenv("CONFIG_PATH")
    raw = config_path if config_path is not None else env_path
    if not raw:
        return _default_config_path()

    path = Path(raw)
    if path.is_absolute():
        return path
    return _backend_root() / path


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError(f"Config root must be a mapping, got {type(data).__name__}")
    return data


class RuntimeConfig:
    """
    Unified facade: YAML tunables + environment Settings.

    Application code should use ``from app.core.config_loader import config``
    and never import ``settings`` directly.
    """

    def __init__(self, app: AppConfig, env: Settings) -> None:
        self._app = app
        self._env = env

    @property
    def app(self) -> AppConfig:
        return self._app

    @property
    def env(self) -> Settings:
        return self._env

    @property
    def models(self) -> ModelsConfig:
        return self._app.models

    @property
    def livekit(self) -> LiveKitConfig:
        return self._app.livekit

    @property
    def vapi(self) -> VapiConfig:
        return self._app.vapi

    @property
    def parsing(self) -> ParsingConfig:
        return self._app.parsing

    @property
    def concurrency(self) -> ConcurrencyConfig:
        return self._app.concurrency

    @property
    def uploads(self) -> UploadsConfig:
        return self._app.uploads

    @property
    def screening(self) -> ScreeningConfig:
        return self._app.screening

    @property
    def interview(self) -> InterviewConfig:
        return self._app.interview

    @property
    def storage(self) -> StorageConfig:
        return self._app.storage

    @property
    def scheduler(self) -> SchedulerConfig:
        return self._app.scheduler

    @property
    def celery(self) -> CeleryRetryConfig:
        return self._app.celery

    def __getattr__(self, name: str) -> Any:
        # Proxy secret / deployment Settings fields (DATABASE_URL, API keys, …).
        try:
            return getattr(self._env, name)
        except AttributeError as exc:
            raise AttributeError(
                f"{type(self).__name__!r} object has no attribute {name!r}"
            ) from exc


_cached: RuntimeConfig | None = None


def load_config(
    config_path: str | None = None,
    *,
    reload: bool = False,
    env: Settings | None = None,
) -> RuntimeConfig:
    """
    Load and validate YAML, merge with Settings, and cache the result.

    Pass reload=True (or a fresh config_path) to bypass the process cache — tests only.
    """
    global _cached
    if _cached is not None and not reload and config_path is None:
        return _cached

    path = resolve_config_path(config_path)
    raw = _read_yaml(path)
    app = AppConfig.model_validate(raw)
    _cached = RuntimeConfig(app=app, env=env or _env_settings)
    return _cached


def get_config(*, reload: bool = False) -> RuntimeConfig:
    return load_config(reload=reload)


class _ConfigProxy:
    """Module-level facade that always reads the current cached RuntimeConfig."""

    def __getattr__(self, name: str) -> Any:
        return getattr(get_config(), name)

    def __repr__(self) -> str:
        return f"<ConfigProxy {get_config()!r}>"


# Eager-load on first access; import-time validation via get_config below.
config = _ConfigProxy()
_ = get_config()
