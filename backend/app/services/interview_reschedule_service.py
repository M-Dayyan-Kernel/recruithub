"""
Reschedule interview — move the current untaken round to a new time and notify the candidate.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.models.models import Candidate, InterviewSession, Job, ScreeningCall
from app.schemas.schemas import InterviewScheduleRequest, InterviewSessionResponse
from app.services.candidate_contact_service import (
    resolve_candidate_email,
    resolve_candidate_name,
)
from app.services.interview_round_service import reschedule_round
from app.services.interview_schedule_service import (
    format_deadline_label,
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


async def send_reschedule_email(
    db: AsyncSession,
    session: InterviewSession,
    candidate: Candidate,
    job_title: str,
) -> bool:
    from app.services.email_service import send_reschedule_notification
    from app.services.email_template_service import get_company_name, get_merged_templates

    job = await db.get(Job, session.job_id)
    tenant_id = job.tenant_id if job else None
    templates = await get_merged_templates(db, tenant_id)
    company_name = await get_company_name(db, tenant_id)
    interview_url = f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    candidate_email = resolve_candidate_email(candidate)
    if not candidate_email:
        logger.warning(
            "Cannot send reschedule email — no valid email for candidate=%s",
            candidate.id,
        )
        return False

    sent = await send_reschedule_notification(
        candidate_name=resolve_candidate_name(candidate),
        candidate_email=candidate_email,
        job_title=job_title,
        interview_url=interview_url,
        templates=templates,
        company_name=company_name,
        deadline_label=format_deadline_label(session, job),
    )
    if sent:
        session.email_sent_at = datetime.now(timezone.utc)
    return sent


async def reschedule_interview(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    *,
    schedule: InterviewScheduleRequest | None = None,
) -> tuple[InterviewSessionResponse, datetime | None]:
    """Move the candidate's current, untaken round to a new time and email them.

    Returns the session and the slot it had before, for the audit row. The session keeps its
    link, so the candidate's earlier email still points at the right interview.
    """
    candidate = await db.get(Candidate, candidate_id)
    if not candidate:
        raise ValueError("Candidate not found")

    job = await db.get(Job, candidate.job_id)
    if not job:
        raise ValueError("Job not found")

    if not await _get_latest_pass_screening(db, candidate_id, candidate.job_id):
        raise ValueError("Candidate has not passed screening")

    scheduled_at = parse_scheduled_at(schedule) if schedule else None
    session, previous_slot = await reschedule_round(
        db, candidate_id=candidate_id, job_id=candidate.job_id, scheduled_at=scheduled_at
    )

    if scheduled_at and schedule:
        await send_scheduled_interview_notification_email(
            db,
            session,
            candidate,
            job.title,
            timezone_name=schedule.timezone or job.screening_timezone,
        )
    else:
        await send_reschedule_email(db, session, candidate, job.title)

    await db.commit()
    await db.refresh(session)

    response = InterviewSessionResponse.model_validate(session)
    response.interview_url = f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    response.candidate_name = candidate.name
    response.job_title = job.title
    logger.info(
        "Interview rescheduled: candidate=%s session=%s round=%s",
        candidate_id,
        session.id,
        session.round_number,
    )
    return response, previous_slot
