"""
Reschedule interview — expire previous session, create new token, notify candidate.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Candidate, InterviewSession, Job, ScreeningCall
from app.schemas.schemas import InterviewScheduleRequest, InterviewSessionResponse
from app.services.interview_schedule_service import (
    parse_scheduled_at,
    send_scheduled_interview_notification_email,
)

logger = logging.getLogger(__name__)


async def _get_latest_pass_screening(
    db: AsyncSession, candidate_id: uuid.UUID, job_id: uuid.UUID
) -> ScreeningCall | None:
    result = await db.execute(
        select(ScreeningCall)
        .where(
            ScreeningCall.candidate_id == candidate_id,
            ScreeningCall.job_id == job_id,
            ScreeningCall.call_status == "completed",
            ScreeningCall.result == "pass",
        )
        .order_by(ScreeningCall.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def _expire_session(session: InterviewSession) -> None:
    if session.status not in ("completed", "expired"):
        session.status = "expired"
    session.expires_at = datetime.now(timezone.utc)


async def send_reschedule_email(
    db: AsyncSession,
    session: InterviewSession,
    candidate: Candidate,
    job_title: str,
) -> bool:
    from app.services.email_service import send_reschedule_notification
    from app.services.email_template_service import get_merged_templates

    templates = await get_merged_templates(db)
    interview_url = f"{settings.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    sent = await send_reschedule_notification(
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        job_title=job_title,
        interview_url=interview_url,
        templates=templates,
    )
    if sent:
        session.email_sent_at = datetime.now(timezone.utc)
    return sent


async def reschedule_interview(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    *,
    schedule: InterviewScheduleRequest | None = None,
) -> InterviewSessionResponse:
    candidate = await db.get(Candidate, candidate_id)
    if not candidate:
        raise ValueError("Candidate not found")

    job = await db.get(Job, candidate.job_id)
    if not job:
        raise ValueError("Job not found")

    if not await _get_latest_pass_screening(db, candidate_id, candidate.job_id):
        raise ValueError("Candidate has not passed screening")

    active_result = await db.execute(
        select(InterviewSession).where(
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.job_id == candidate.job_id,
            InterviewSession.status.in_(["pending", "in_progress"]),
        )
    )
    if active_result.scalars().first():
        raise ValueError("An active interview session already exists for this candidate")

    previous_result = await db.execute(
        select(InterviewSession)
        .where(
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.job_id == candidate.job_id,
        )
        .order_by(InterviewSession.created_at.desc())
    )
    previous_sessions = previous_result.scalars().all()
    previous = previous_sessions[0] if previous_sessions else None

    scheduled_at = None
    if schedule:
        scheduled_at = parse_scheduled_at(schedule)
        now = datetime.now(timezone.utc)
        if scheduled_at < now - timedelta(minutes=1):
            raise ValueError("Scheduled time must be in the future")

    unique_token = str(uuid.uuid4())
    expires_at = (
        scheduled_at + timedelta(days=7)
        if scheduled_at
        else datetime.now(timezone.utc) + timedelta(days=7)
    )

    new_session = InterviewSession(
        candidate_id=candidate_id,
        job_id=candidate.job_id,
        unique_token=unique_token,
        status="pending",
        scheduled_interview_at=scheduled_at,
        expires_at=expires_at,
        rescheduled_from_session_id=previous.id if previous else None,
    )
    db.add(new_session)

    if previous:
        await _expire_session(previous)

    await db.flush()

    interview_url = f"{settings.CANDIDATE_APP_URL}/interview/{unique_token}"
    job_title = job.title

    if scheduled_at and schedule:
        await send_scheduled_interview_notification_email(
            db,
            new_session,
            candidate,
            job_title,
            timezone_name=schedule.timezone or job.screening_timezone,
        )
    else:
        await send_reschedule_email(db, new_session, candidate, job_title)

    await db.commit()
    await db.refresh(new_session)

    response = InterviewSessionResponse.model_validate(new_session)
    response.interview_url = interview_url
    response.candidate_name = candidate.name
    response.job_title = job_title
    logger.info(
        "Interview rescheduled: candidate=%s new_session=%s superseded=%s",
        candidate_id,
        new_session.id,
        previous.id if previous else None,
    )
    return response
