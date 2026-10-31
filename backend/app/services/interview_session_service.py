"""
Shared helpers for creating pending interview sessions.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Candidate, InterviewSession, Job
from app.services.interview_round_service import place_first_round
from app.services.interview_status import IN_PROGRESS, PENDING

logger = logging.getLogger(__name__)


async def get_active_interview_session(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
) -> InterviewSession | None:
    result = await db.execute(
        select(InterviewSession).where(
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.job_id == job_id,
            InterviewSession.status.in_([PENDING, IN_PROGRESS]),
        )
    )
    return result.scalars().first()


async def create_pending_interview_session(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    scheduled_at: datetime | None = None,
) -> tuple[InterviewSession, Candidate, str]:
    """
    Give the application its first interview round: a new pending session, or a cancelled or
    expired one reopened. Its link expires session_link_ttl_days from now (or from the slot).

    Returns (session, candidate, job_title). Raises ValueError if the candidate or job is
    missing, and a DomainError (ConflictError) if the application already has a pending, live
    or taken round: those are rescheduled or followed by the next round, never recreated.
    """
    candidate_result = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    candidate = candidate_result.scalars().first()
    if not candidate:
        raise ValueError("Candidate not found")

    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalars().first()
    if not job:
        raise ValueError("Job not found")

    interview_session = await place_first_round(
        db, candidate_id=candidate_id, job_id=job_id, scheduled_at=scheduled_at
    )
    logger.info(
        "Placed interview round %s session=%s candidate=%s job=%s",
        interview_session.round_number,
        interview_session.id,
        candidate_id,
        job_id,
    )
    return interview_session, candidate, job.title
