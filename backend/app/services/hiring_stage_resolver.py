"""Resolve a single HR-facing hiring stage label from pipeline entities."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.models import (
        Candidate,
        InterviewReport,
        InterviewSession,
        ScreeningCall,
        ShortlistResult,
    )


def resolve_hiring_stage(
    candidate: Candidate,
    *,
    shortlist: ShortlistResult | None = None,
    screening: ScreeningCall | None = None,
    interview_session: InterviewSession | None = None,
    interview_report: InterviewReport | None = None,
) -> str:
    """Return a display label for the candidate's current hiring stage."""
    manual_status = (candidate.status or "active").lower()
    if manual_status == "hired":
        return "Hired"
    if manual_status == "rejected":
        return "Rejected"

    if candidate.pipeline_status == "failed":
        return "Failed"
    if candidate.pipeline_status in ("queued", "processing"):
        return "Processing"

    # Rejected by HR is final for this label, whatever the candidate's last call or interview
    # looks like: a rejection cancels what was unstarted, and Reconsider is the way back.
    if shortlist is not None and shortlist.hr_decision == "rejected":
        return "Rejected"

    # A finalist is an application-level mark, set after at least one taken interview round.
    if shortlist is not None and shortlist.finalist_at is not None:
        return "Finalist"

    # Any round, whatever its state, keeps the candidate in this stage: a cancelled or expired
    # one is rescheduled, a taken one is followed by the next round.
    if interview_session is not None or interview_report is not None:
        return "Interview"

    if screening is not None:
        # "cancelled": HR cancelled the queued call; the candidate is still in this stage.
        if screening.call_status in ("pending", "in_progress", "cancelled") or (
            screening.call_status == "completed" and screening.result in (None, "needs_review")
        ):
            return "Screening"
        if screening.call_status == "completed" and screening.result == "fail":
            return "Rejected"
        if screening.call_status == "completed" and screening.result == "pass":
            if interview_session is None:
                return "Screening"

    if shortlist is not None:
        return "AI Shortlisted"

    if candidate.pipeline_status == "completed":
        return "Processing"

    return "Processing"
