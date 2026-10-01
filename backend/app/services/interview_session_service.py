"""
Shared helpers for creating pending interview sessions.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.models.models import Candidate, InterviewSession, Job

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
            InterviewSession.status.in_(["pending", "in_progress"]),
        )
    )
    return result.scalars().first()


async def create_pending_interview_session(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
) -> tuple[InterviewSession, Candidate, str]:
    """
    Create a pending InterviewSession with a 7-day expiry.

    Returns (session, candidate, job_title). Raises ValueError if candidate/job missing
    or an active session already exists.
    """
    candidate_result = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    candidate = candidate_result.scalars().first()
    if not candidate:
        raise ValueError("Candidate not found")

    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalars().first()
    if not job:
        raise ValueError("Job not found")

    existing = await get_active_interview_session(db, candidate_id=candidate_id, job_id=job_id)
    if existing:
        raise ValueError("An active interview session already exists for this candidate")

    unique_token = str(uuid.uuid4())
    interview_session = InterviewSession(
        candidate_id=candidate_id,
        job_id=job_id,
        unique_token=unique_token,
        status="pending",
        expires_at=datetime.now(timezone.utc)
        + timedelta(days=config.interview.session_link_ttl_days),
    )
    db.add(interview_session)
    await db.flush()
    logger.info(
        "Created interview session %s for candidate=%s job=%s",
        interview_session.id,
        candidate_id,
        job_id,
    )
    return interview_session, candidate, job.title
