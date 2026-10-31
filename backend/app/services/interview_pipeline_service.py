"""
Interview pipeline — classify screening-passed candidates into HR workflow tabs.
"""

from __future__ import annotations

import logging
import uuid
from typing import Literal, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.screening_skipped import is_skipped_call, skip_reason
from app.models.models import (
    Candidate,
    InterviewReport,
    InterviewSession,
    Job,
    ScreeningCall,
    ShortlistResult,
)
from app.schemas.schemas import (
    InterviewPipelineCandidate,
    InterviewPipelineCounts,
    InterviewPipelineResponse,
    InterviewSessionResponse,
)
from app.services.interview_flag_service import get_flag_reason, is_flagged_session
from app.services.interview_report_labels import map_recommendation_label
from app.services.interview_round_service import available_actions, counted_rounds, latest_round
from app.services.interview_status import CANCELLED, IN_PROGRESS, TAKEN, is_live
from app.services.rejection_filter import rejected_candidate_ids

logger = logging.getLogger(__name__)

InterviewTabStage = Literal["pending", "scheduled", "ongoing", "completed", "flagged", "finalists"]


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


def classify_interview_tab(
    session: InterviewSession | None,
    *,
    has_report: bool = False,
    finalist: bool = False,
) -> InterviewTabStage:
    """Map the application's current round to an HR-facing pipeline tab."""
    if finalist:
        return "finalists"
    if is_flagged_session(session, has_report=has_report):
        return "flagged"
    if not session:
        return "completed" if has_report else "pending"
    if session.status == CANCELLED:
        # Back to "needs a link": HR reschedules it from here.
        return "scheduled"
    if session.status == IN_PROGRESS:
        return "ongoing"
    # Interview finished (or assessment running/failed) → Completed, not Scheduled.
    if has_report or session.status in TAKEN:
        return "completed"
    return "scheduled"


def _enrich_session(
    session: InterviewSession,
    candidate: Candidate | None,
    job_title: str,
) -> InterviewSessionResponse:
    response = InterviewSessionResponse.model_validate(session)
    response.interview_url = (
        f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
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
        select(InterviewSession).where(InterviewSession.job_id == job_id)
    )
    sessions_by_candidate: dict[uuid.UUID, list[InterviewSession]] = {}
    for session in sessions_result.scalars().all():
        sessions_by_candidate.setdefault(session.candidate_id, []).append(session)
    # The current round: the highest-numbered one that is not voided (a retake replaces it).
    latest_session_by_candidate: dict[uuid.UUID, InterviewSession] = {
        candidate_id: round_
        for candidate_id, sessions in sessions_by_candidate.items()
        if (round_ := latest_round(sessions)) is not None
    }
    finalist_ids = set(
        (
            await db.execute(
                select(ShortlistResult.candidate_id).where(
                    ShortlistResult.job_id == job_id, ShortlistResult.finalist_at.is_not(None)
                )
            )
        ).scalars().all()
    )

    # Rejected candidates are in the Rejected stage, not here: dropped before anything is
    # counted, so the tab counts match what the tabs list.
    rejected_ids = await rejected_candidate_ids(db, job_id)
    eligible_candidate_ids = [
        candidate_id
        for candidate_id, pass_call in latest_pass_by_candidate.items()
        if candidate_id not in rejected_ids
        and (pass_call.interview_queued_at is not None or candidate_id in latest_session_by_candidate)
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
    report_by_session_id: dict[uuid.UUID, InterviewReport] = {}
    for report in reports_result.scalars().all():
        if report.interview_session_id not in report_by_session_id:
            report_by_session_id[report.interview_session_id] = report

    counts = InterviewPipelineCounts(
        pending=0, scheduled=0, ongoing=0, completed=0, flagged=0, finalists=0
    )
    pipeline_candidates: list[InterviewPipelineCandidate] = []

    for candidate_id in eligible_candidate_ids:
        candidate = candidate_map.get(candidate_id)
        session = latest_session_by_candidate.get(candidate_id)
        pass_call = latest_pass_by_candidate.get(candidate_id)
        # Only the current round's report: another round's scores never show on this card.
        card_report = report_by_session_id.get(session.id) if session is not None else None
        has_report = card_report is not None
        finalist = candidate_id in finalist_ids
        stage = classify_interview_tab(session, has_report=has_report, finalist=finalist)

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

        if tab is not None:
            if tab in ("scheduled", "pending") and stage in ("pending", "scheduled"):
                pass
            elif stage != tab:
                continue

        candidate_sessions = sessions_by_candidate.get(candidate_id, [])
        actions = (
            []
            if candidate is None
            else available_actions(
                candidate_sessions,
                rejected=False,  # rejected candidates were dropped above
                finalist=finalist,
                flagged=stage == "flagged",
                has_report=has_report,
            )
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
                report_overall_score=card_report.overall_score if card_report else None,
                report_recommendation=map_recommendation_label(
                    card_report.final_recommendation if card_report else None
                ),
                assessment_status=_assessment_status(session, has_report=has_report),
                flag_reason=get_flag_reason(session, has_report=has_report),
                round_number=session.round_number if session else 0,
                round_count=len(counted_rounds(candidate_sessions)),
                is_live=bool(session) and is_live(session),
                finalist=finalist,
                available_actions=actions,
                screening_skipped=pass_call is not None and is_skipped_call(pass_call),
                skip_reason=skip_reason(pass_call) if pass_call is not None else None,
            )
        )

    pipeline_candidates.sort(
        key=lambda row: (row.candidate_name or "").lower(),
    )

    logger.debug(
        "Interview pipeline job=%s tab=%s candidates=%d",
        job_id,
        tab,
        len(pipeline_candidates),
    )
    return InterviewPipelineResponse(counts=counts, candidates=pipeline_candidates)
