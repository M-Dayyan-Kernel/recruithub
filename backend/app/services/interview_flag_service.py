"""
Interview flagging — classify sessions that never produced a meaningful interview.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.models.models import InterviewSession

MIN_MEANINGFUL_TRANSCRIPT_CHARS = 80


def has_meaningful_transcript(transcript: str | None) -> bool:
    """True when transcript looks like a real conversation (not empty/invalid)."""
    text = (transcript or "").strip()
    if len(text) < MIN_MEANINGFUL_TRANSCRIPT_CHARS:
        return False
    lower = text.lower()
    # Require at least one agent and one candidate turn marker
    has_agent = "agent:" in lower or "assistant:" in lower or "interviewer:" in lower
    has_candidate = "candidate:" in lower or "user:" in lower
    if has_agent and has_candidate:
        return True
    # Fallback: long enough free-form transcript
    return len(text) >= 200


def _is_expired(session: InterviewSession, *, now: datetime | None = None) -> bool:
    if session.status == "expired":
        return True
    if session.expires_at:
        ref = now or datetime.now(timezone.utc)
        return session.expires_at < ref
    return False


def get_flag_reason(session: InterviewSession | None, *, has_report: bool = False) -> str | None:
    """Return a human-readable flag reason, or None if the session should not be flagged."""
    if not session or has_report:
        return None
    if has_meaningful_transcript(session.transcript):
        return None
    if session.status == "in_progress":
        return None
    if session.status == "pending" and not _is_expired(session):
        return None

    if not session.started_at:
        if _is_expired(session) or session.status == "expired":
            return "Interview link expired — candidate never joined"
        if session.status == "completed":
            return "Interview marked complete but was never started"
        return "Interview was never attempted"

    if session.status == "assessment_failed":
        return "Assessment could not be generated — no usable transcript"

    if session.status in ("completed", "expired"):
        transcript = (session.transcript or "").strip()
        if not transcript:
            return "No transcript recorded — interview may have failed before conversation started"
        return "Transcript too short or invalid — no meaningful conversation occurred"

    return "Interview did not produce a usable result"


def is_flagged_session(session: InterviewSession | None, *, has_report: bool = False) -> bool:
    return get_flag_reason(session, has_report=has_report) is not None
