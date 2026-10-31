"""
Interview finalists — applications HR marked as finalists after a taken interview round.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Candidate, InterviewReport, InterviewSession, Job, ScreeningCall, ShortlistResult
from app.schemas.schemas import FinalistCandidate, FinalistsResponse
from app.services.interview_round_service import counted_rounds, latest_round
from app.services.interview_report_labels import map_recommendation_label
from app.services.rejection_filter import rejected_candidate_ids


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


async def list_finalists(db: AsyncSession, job_id: uuid.UUID) -> FinalistsResponse:
    job = await db.get(Job, job_id)
    if not job:
        raise ValueError("Job not found")

    rejected_ids = await rejected_candidate_ids(db, job_id)
    finalist_ids = [
        candidate_id
        for candidate_id in (
            await db.execute(
                select(ShortlistResult.candidate_id).where(
                    ShortlistResult.job_id == job_id, ShortlistResult.finalist_at.is_not(None)
                )
            )
        ).scalars().all()
        if candidate_id not in rejected_ids
    ]
    if not finalist_ids:
        return FinalistsResponse(candidates=[])

    finalist_at = dict(
        (
            await db.execute(
                select(ShortlistResult.candidate_id, ShortlistResult.finalist_at).where(
                    ShortlistResult.job_id == job_id,
                    ShortlistResult.candidate_id.in_(finalist_ids),
                )
            )
        ).all()
    )
    sessions_result = await db.execute(
        select(InterviewSession).where(
            InterviewSession.job_id == job_id, InterviewSession.candidate_id.in_(finalist_ids)
        )
    )
    sessions_by_candidate: dict[uuid.UUID, list[InterviewSession]] = {}
    for session in sessions_result.scalars().all():
        sessions_by_candidate.setdefault(session.candidate_id, []).append(session)
    latest_by_candidate = {
        candidate_id: latest_round(sessions) for candidate_id, sessions in sessions_by_candidate.items()
    }

    candidates_result = await db.execute(select(Candidate).where(Candidate.id.in_(finalist_ids)))
    candidate_map = {c.id: c for c in candidates_result.scalars().all()}

    reports_result = await db.execute(
        select(InterviewReport).where(
            InterviewReport.interview_session_id.in_(
                [s.id for s in latest_by_candidate.values() if s is not None]
            )
        )
    )
    report_by_session = {r.interview_session_id: r for r in reports_result.scalars().all()}

    screening_result = await db.execute(
        select(ScreeningCall)
        .where(
            ScreeningCall.job_id == job_id,
            ScreeningCall.candidate_id.in_(finalist_ids),
            ScreeningCall.call_status == "completed",
        )
        .order_by(ScreeningCall.created_at.desc())
    )
    latest_screening: dict[uuid.UUID, ScreeningCall] = {}
    for call in screening_result.scalars().all():
        if call.candidate_id not in latest_screening:
            latest_screening[call.candidate_id] = call

    rows: list[FinalistCandidate] = []
    for candidate_id in finalist_ids:
        session = latest_by_candidate.get(candidate_id)
        if session is None:
            continue
        candidate = candidate_map.get(candidate_id)
        report = report_by_session.get(session.id)
        screening = latest_screening.get(candidate_id)
        parsed = candidate.parsed_data if candidate else None
        email = (candidate.email if candidate else None) or (parsed.get("email") if parsed else None)
        phone = (candidate.phone if candidate else None) or (parsed.get("phone") if parsed else None)

        rows.append(
            FinalistCandidate(
                candidate_id=candidate_id,
                session_id=session.id,
                candidate_name=candidate.name if candidate else None,
                email=email,
                phone=phone,
                current_ctc=screening.current_ctc if screening else None,
                expected_ctc=screening.expected_ctc if screening else None,
                total_experience_years=_experience_years(candidate),
                report_overall_score=report.overall_score if report else None,
                report_recommendation=map_recommendation_label(
                    report.final_recommendation if report else None
                ),
                round_count=len(counted_rounds(sessions_by_candidate[candidate_id])),
                finalist_at=finalist_at.get(candidate_id),
                completed_at=session.completed_at,
            )
        )

    rows.sort(key=lambda r: (r.candidate_name or "").lower())
    return FinalistsResponse(candidates=rows)
