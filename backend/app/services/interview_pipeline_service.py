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
from app.services.interview_flag_service import get_flag_reason, is_flagged_session

InterviewTabStage = Literal["pending", "scheduled", "ongoing", "completed", "flagged", "finalists"]


def _map_recommendation_label(rec: str | None) -> str | None:
    if not rec:
        return None
    normalized = rec.lower().replace(" ", "_")
    if normalized in ("strong_hire", "hire"):
        return "Hire"
    if normalized == "no_hire":
        return "No Hire"
    if normalized in ("hold", "needs_review"):
        return "Needs Review"
    return rec.replace("_", " ").title()


def _assessment_status(
    session: InterviewSession | None,
    *,
    has_report: bool,
) -> str:
    if has_report:
        return "ready"
    if not session:
        return "none"
    if session.status == "assessment_failed":
        return "failed"
    if session.status in ("completed", "assessed") and session.started_at:
        return "generating"
    return "none"


def _session_hr_decision(session: InterviewSession | None) -> str:
    if not session:
        return "pending"
    return getattr(session, "hr_decision", None) or "pending"


def classify_interview_tab(
    session: InterviewSession | None,
    *,
    has_report: bool = False,
) -> InterviewTabStage:
    """Map latest session state to an HR-facing pipeline tab."""
    if is_flagged_session(session, has_report=has_report):
        return "flagged"
    if not session:
        return "completed" if has_report else "pending"
    if session.status == "in_progress":
        return "ongoing"
    # Interview finished (or assessment running/failed) → Completed, not Scheduled.
    if has_report or session.status in ("completed", "assessed", "assessment_failed"):
        if _session_hr_decision(session) == "approved":
            return "finalists"
        return "completed"
    if session.status == "pending":
        return "scheduled"
    return "scheduled"


def _has_active_session(sessions: list[InterviewSession]) -> bool:
    return any(s.status in ("pending", "in_progress") for s in sessions)


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
    all_sessions = sessions_result.scalars().all()
    latest_session_by_candidate: dict[uuid.UUID, InterviewSession] = {}
    sessions_by_candidate: dict[uuid.UUID, list[InterviewSession]] = {}
    for session in all_sessions:
        sessions_by_candidate.setdefault(session.candidate_id, []).append(session)
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
            pending=0, scheduled=0, ongoing=0, completed=0, flagged=0, finalists=0
        )
        return InterviewPipelineResponse(counts=empty_counts, candidates=[])

    candidates_result = await db.execute(
        select(Candidate).where(Candidate.id.in_(eligible_candidate_ids))
    )
    candidate_map = {c.id: c for c in candidates_result.scalars().all()}

    reports_result = await db.execute(
        select(InterviewReport)
        .where(
            InterviewReport.job_id == job_id,
            InterviewReport.candidate_id.in_(eligible_candidate_ids),
        )
        .order_by(InterviewReport.created_at.desc())
    )
    latest_report_by_candidate: dict[uuid.UUID, InterviewReport] = {}
    for report in reports_result.scalars().all():
        if report.candidate_id not in latest_report_by_candidate:
            latest_report_by_candidate[report.candidate_id] = report

    counts = InterviewPipelineCounts(
        pending=0, scheduled=0, ongoing=0, completed=0, flagged=0, finalists=0
    )
    pipeline_candidates: list[InterviewPipelineCandidate] = []

    for candidate_id in eligible_candidate_ids:
        candidate = candidate_map.get(candidate_id)
        session = latest_session_by_candidate.get(candidate_id)
        report = latest_report_by_candidate.get(candidate_id)
        has_report = (
            report is not None
            and session is not None
            and report.interview_session_id == session.id
        )
        stage = classify_interview_tab(session, has_report=has_report)

        if stage == "pending":
            counts.pending += 1
        elif stage == "scheduled":
            counts.scheduled += 1
        elif stage == "ongoing":
            counts.ongoing += 1
        elif stage == "flagged":
            counts.flagged += 1
        elif stage == "finalists":
            counts.finalists += 1
        else:
            counts.completed += 1

        if tab is not None and stage != tab:
            continue

        candidate_sessions = sessions_by_candidate.get(candidate_id, [])
        has_other_active = _has_active_session(
            [s for s in candidate_sessions if session is None or s.id != session.id]
        )
        actions_disabled = candidate is None
        can_reschedule = (
            not actions_disabled
            and not has_other_active
            and stage in ("completed", "flagged")
        )

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
                report_overall_score=report.overall_score if report else None,
                report_recommendation=_map_recommendation_label(
                    report.final_recommendation if report else None
                ),
                assessment_status=_assessment_status(session, has_report=has_report),
                flag_reason=get_flag_reason(session, has_report=has_report),
                can_reschedule=can_reschedule,
                actions_disabled=actions_disabled,
                has_active_session=has_other_active,
                hr_decision=_session_hr_decision(session),
            )
        )

    pipeline_candidates.sort(
        key=lambda row: (row.candidate_name or "").lower(),
    )

    return InterviewPipelineResponse(counts=counts, candidates=pipeline_candidates)
