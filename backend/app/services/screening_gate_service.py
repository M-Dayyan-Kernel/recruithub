"""Voice screening gate — per-job effective checks."""

from __future__ import annotations

from app.models.models import Job
from app.services.settings_service import CachedSettings

BYPASS_SUMMARY_JOB = "Screening bypassed — voice screening disabled for this job"


def is_voice_screening_effective(settings: CachedSettings, job: Job) -> bool:
    """Job-level flag controls screening; tenant setting is the default for new jobs only."""
    del settings  # kept for call-site compatibility
    return bool(job.voice_screening_enabled)


def screening_disabled_reason(settings: CachedSettings, job: Job) -> str | None:
    del settings
    if not job.voice_screening_enabled:
        return "Voice screening is disabled for this job"
    return None


def bypass_summary_for(settings: CachedSettings, job: Job) -> str:
    del settings
    return BYPASS_SUMMARY_JOB
