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

    if interview_session is not None:
        hr_decision = getattr(interview_session, "hr_decision", None) or "pending"
        if interview_report is not None and hr_decision == "approved":
            return "Finalist"
        if interview_session.status in ("pending", "in_progress"):
            return "Interview"
        if interview_session.status in ("completed", "assessed", "assessment_failed") or interview_report:
            if hr_decision == "approved":
                return "Finalist"
            return "Interview"

    if screening is not None:
        if screening.call_status in ("pending", "in_progress") or (
            screening.call_status == "completed" and screening.result in (None, "needs_review")
        ):
            return "Screening"
        if screening.call_status == "completed" and screening.result == "fail":
            return "Rejected"
        if screening.call_status == "completed" and screening.result == "pass":
            if interview_session is None:
                return "Screening"

    if shortlist is not None:
        if shortlist.hr_decision == "rejected":
            return "Rejected"
        return "AI Shortlisted"

    if candidate.pipeline_status == "completed":
        return "Processing"

    return "Processing"
