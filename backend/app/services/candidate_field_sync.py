"""Sync candidate display fields from screening extraction."""

from __future__ import annotations

from app.models.models import Candidate, ScreeningCall


def prefill_candidate_compensation_from_screening(
    candidate: Candidate,
    screening: ScreeningCall,
) -> None:
    """Copy screening-extracted compensation fields when candidate values are unset."""
    if candidate.current_ctc is None and screening.current_ctc:
        candidate.current_ctc = screening.current_ctc
    if candidate.expected_ctc is None and screening.expected_ctc:
        candidate.expected_ctc = screening.expected_ctc
    if candidate.notice_period is None and screening.notice_period:
        candidate.notice_period = screening.notice_period
