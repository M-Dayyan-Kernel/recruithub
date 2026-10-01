"""
Interview flagging — classify sessions that never produced a meaningful interview.

Flagged is only for interviews that were never actually attempted (or clearly never
connected). Once a candidate has started an interview, the session belongs in
Completed while the report generates — not Flagged.
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
    # Match labels used by the LiveKit interview agent (AI / Candidate) and common variants
    has_agent = any(
        token in lower
        for token in ("ai:", "agent:", "assistant:", "interviewer:")
    )
    has_candidate = any(
        token in lower for token in ("candidate:", "user:", "human:")
    )
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

    # Candidate joined / interview started — keep in Completed (report may still be generating).
    # Do not bounce these through Flagged while waiting for transcript or assessment.
    if session.started_at and session.status in (
        "completed",
        "assessed",
        "assessment_failed",
    ):
        return None

    if not session.started_at:
        if _is_expired(session) or session.status == "expired":
            return "Interview link expired — candidate never joined"
        if session.status == "completed":
            return "Interview marked complete but was never started"
        return "Interview was never attempted"

    if session.status == "expired":
        transcript = (session.transcript or "").strip()
        if not transcript:
            return "No transcript recorded — interview may have failed before conversation started"
        return "Transcript too short or invalid — no meaningful conversation occurred"

    return "Interview did not produce a usable result"


def is_flagged_session(session: InterviewSession | None, *, has_report: bool = False) -> bool:
    return get_flag_reason(session, has_report=has_report) is not None
