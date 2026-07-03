"""
Interview pipeline — classify screening-passed candidates into HR workflow tabs.
"""

from __future__ import annotations

import uuid
from typing import Literal, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import (
    Candidate,
    InterviewReport,
    InterviewSession,
    Job,
    ScreeningCall,
)
from app.schemas.schemas import (
    InterviewPipelineCandidate,
    InterviewPipelineCounts,
    InterviewPipelineResponse,
    InterviewSessionResponse,
)

InterviewTabStage = Literal["pending", "scheduled", "ongoing", "completed"]


def classify_interview_tab(
    session: InterviewSession | None,
    *,
    has_report: bool = False,
) -> InterviewTabStage:
    """Map latest session state to an HR-facing pipeline tab."""
    if not session:
        return "completed" if has_report else "pending"
    if session.status == "in_progress" and not has_report:
        return "ongoing"
    if session.status == "completed" or has_report:
        return "completed"
    return "scheduled"


def _enrich_session(
    session: InterviewSession,
    candidate: Candidate | None,
    job_title: str,
) -> InterviewSessionResponse:
    response = InterviewSessionResponse.model_validate(session)
    response.interview_url = (
        f"{settings.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    )
    response.candidate_name = candidate.name if candidate else None
    response.job_title = job_title
    return response


async def get_interview_pipeline(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    tab: Optional[InterviewTabStage] = None,
) -> InterviewPipelineResponse:
    job = await db.get(Job, job_id)
    if not job:
        raise ValueError("Job not found")

    passed_calls_result = await db.execute(
        select(ScreeningCall)
        .where(
            ScreeningCall.job_id == job_id,
            ScreeningCall.call_status == "completed",
            ScreeningCall.result == "pass",
        )
        .order_by(ScreeningCall.created_at.desc())
    )
    latest_pass_by_candidate: dict[uuid.UUID, ScreeningCall] = {}
    for call in passed_calls_result.scalars().all():
        if call.candidate_id not in latest_pass_by_candidate:
            latest_pass_by_candidate[call.candidate_id] = call

    sessions_result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.job_id == job_id)
        .order_by(InterviewSession.created_at.desc())
    )
    latest_session_by_candidate: dict[uuid.UUID, InterviewSession] = {}
    for session in sessions_result.scalars().all():
        if session.candidate_id not in latest_session_by_candidate:
            latest_session_by_candidate[session.candidate_id] = session

    eligible_candidate_ids = [
        candidate_id
        for candidate_id, pass_call in latest_pass_by_candidate.items()
        if pass_call.interview_queued_at is not None
        or candidate_id in latest_session_by_candidate
    ]
    if not eligible_candidate_ids:
        empty_counts = InterviewPipelineCounts(
            pending=0, scheduled=0, ongoing=0, completed=0
        )
        return InterviewPipelineResponse(counts=empty_counts, candidates=[])

    candidates_result = await db.execute(
        select(Candidate).where(Candidate.id.in_(eligible_candidate_ids))
    )
    candidate_map = {c.id: c for c in candidates_result.scalars().all()}

    reports_result = await db.execute(
        select(InterviewReport.candidate_id)
        .where(
            InterviewReport.job_id == job_id,
            InterviewReport.candidate_id.in_(eligible_candidate_ids),
        )
        .distinct()
    )
    candidates_with_report = set(reports_result.scalars().all())

    counts = InterviewPipelineCounts(
        pending=0, scheduled=0, ongoing=0, completed=0
    )
    pipeline_candidates: list[InterviewPipelineCandidate] = []

    for candidate_id in eligible_candidate_ids:
        candidate = candidate_map.get(candidate_id)
        session = latest_session_by_candidate.get(candidate_id)
        has_report = candidate_id in candidates_with_report
        stage = classify_interview_tab(session, has_report=has_report)

        if stage == "pending":
            counts.pending += 1
        elif stage == "scheduled":
            counts.scheduled += 1
        elif stage == "ongoing":
            counts.ongoing += 1
        else:
            counts.completed += 1

        if tab is not None and stage != tab:
            continue

        session_response = (
            _enrich_session(session, candidate, job.title) if session else None
        )
        pipeline_candidates.append(
            InterviewPipelineCandidate(
                candidate_id=candidate_id,
                candidate_name=candidate.name if candidate else None,
                tab=stage,
                has_report=has_report,
                session=session_response,
            )
        )

    pipeline_candidates.sort(
        key=lambda row: (row.candidate_name or "").lower(),
    )

    return InterviewPipelineResponse(counts=counts, candidates=pipeline_candidates)
