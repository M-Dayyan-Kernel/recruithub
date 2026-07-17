"""
Interview finalists — HR approve/reject after completed interviews.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import settings
from app.models.models import Candidate, InterviewReport, InterviewSession, Job, ScreeningCall
from app.schemas.schemas import FinalistCandidate, FinalistsResponse, InterviewSessionResponse
from app.services.interview_flag_service import is_flagged_session


def _session_is_completed_for_decision(
    session: InterviewSession,
    *,
    has_report: bool,
) -> bool:
    if is_flagged_session(session, has_report=has_report):
        return False
    return has_report or session.status in ("completed", "assessed", "assessment_failed")


def _experience_years(candidate: Candidate | None) -> float | None:
    if not candidate or not candidate.parsed_data:
        return None
    value = candidate.parsed_data.get("total_experience_years")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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


async def set_interview_hr_decision(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    hr_decision: Literal["approved", "rejected"],
) -> InterviewSessionResponse:
    candidate = await db.get(Candidate, candidate_id)
    if not candidate:
        raise ValueError("Candidate not found")

    sessions_result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.candidate_id == candidate_id)
        .order_by(InterviewSession.created_at.desc())
    )
    sessions = list(sessions_result.scalars().all())
    if not sessions:
        raise ValueError("No interview session found for candidate")

    session = sessions[0]
    report_result = await db.execute(
        select(InterviewReport).where(InterviewReport.interview_session_id == session.id)
    )
    has_report = report_result.scalar_one_or_none() is not None

    if not _session_is_completed_for_decision(session, has_report=has_report):
        raise ValueError("Interview must be completed before approving or rejecting")

    session.hr_decision = hr_decision
    await db.commit()
    await db.refresh(session)

    job = await db.get(Job, session.job_id)
    response = InterviewSessionResponse.model_validate(session)
    response.interview_url = f"{settings.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    response.candidate_name = candidate.name
    response.job_title = job.title if job else None
    return response


async def list_finalists(db: AsyncSession, job_id: uuid.UUID) -> FinalistsResponse:
    job = await db.get(Job, job_id)
    if not job:
        raise ValueError("Job not found")

    all_latest_result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.job_id == job_id)
        .order_by(InterviewSession.created_at.desc())
    )
    overall_latest: dict[uuid.UUID, InterviewSession] = {}
    for session in all_latest_result.scalars().all():
        if session.candidate_id not in overall_latest:
            overall_latest[session.candidate_id] = session

    finalist_sessions = [
        session
        for session in overall_latest.values()
        if session.hr_decision == "approved"
    ]

    if not finalist_sessions:
        return FinalistsResponse(candidates=[])

    candidate_ids = [s.candidate_id for s in finalist_sessions]
    candidates_result = await db.execute(select(Candidate).where(Candidate.id.in_(candidate_ids)))
    candidate_map = {c.id: c for c in candidates_result.scalars().all()}

    reports_result = await db.execute(
        select(InterviewReport).where(
            InterviewReport.interview_session_id.in_([s.id for s in finalist_sessions])
        )
    )
    report_by_session = {r.interview_session_id: r for r in reports_result.scalars().all()}

    screening_result = await db.execute(
        select(ScreeningCall)
        .where(
            ScreeningCall.job_id == job_id,
            ScreeningCall.candidate_id.in_(candidate_ids),
            ScreeningCall.call_status == "completed",
        )
        .order_by(ScreeningCall.created_at.desc())
    )
    latest_screening: dict[uuid.UUID, ScreeningCall] = {}
    for call in screening_result.scalars().all():
        if call.candidate_id not in latest_screening:
            latest_screening[call.candidate_id] = call

    rows: list[FinalistCandidate] = []
    for session in finalist_sessions:
        candidate = candidate_map.get(session.candidate_id)
        report = report_by_session.get(session.id)
        screening = latest_screening.get(session.candidate_id)
        parsed = candidate.parsed_data if candidate else None
        email = (candidate.email if candidate else None) or (parsed.get("email") if parsed else None)
        phone = (candidate.phone if candidate else None) or (parsed.get("phone") if parsed else None)

        rows.append(
            FinalistCandidate(
                candidate_id=session.candidate_id,
                session_id=session.id,
                candidate_name=candidate.name if candidate else None,
                email=email,
                phone=phone,
                current_ctc=screening.current_ctc if screening else None,
                expected_ctc=screening.expected_ctc if screening else None,
                total_experience_years=_experience_years(candidate),
                report_overall_score=report.overall_score if report else None,
                report_recommendation=_map_recommendation_label(
                    report.final_recommendation if report else None
                ),
                hr_decision=session.hr_decision,
                completed_at=session.completed_at,
            )
        )

    rows.sort(key=lambda r: (r.candidate_name or "").lower())
    return FinalistsResponse(candidates=rows)
