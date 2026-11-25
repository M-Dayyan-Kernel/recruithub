"""Map directory list stage filter values to resolved hiring-stage labels."""

from __future__ import annotations

from typing import Literal

CandidateStageFilter = Literal[
    "ai_shortlisted",
    "screening",
    "interview",
    "finalists",
    "processing",
    "failed",
    "rejected",
    "hired",
]

STAGE_FILTER_TO_LABEL: dict[CandidateStageFilter, str] = {
    "ai_shortlisted": "AI Shortlisted",
    "screening": "Screening",
    "interview": "Interview",
    "finalists": "Finalist",
    "processing": "Processing",
    "failed": "Failed",
    "rejected": "Rejected",
    "hired": "Hired",
}


def stage_filter_label(stage: CandidateStageFilter) -> str:
    return STAGE_FILTER_TO_LABEL[stage]
