"""
Parse queue — limits concurrent resume parsing per job.

Only up to MAX_CONCURRENT_PARSES candidates may be in `parsing` or `parsed`
at once. Additional `pending_parse` candidates wait in the Upload queue until
a slot opens.
"""

import asyncio
import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_celery_db
from app.models.models import Candidate

logger = logging.getLogger(__name__)

ACTIVE_PARSE_STATUSES = ("parsing", "parsed")


async def _count_active_parses(session: AsyncSession, job_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Candidate)
        .where(
            Candidate.job_id == job_id,
            Candidate.parse_status.in_(ACTIVE_PARSE_STATUSES),
        )
    )
    return int(result.scalar() or 0)


async def dispatch_parse_slots(session: AsyncSession, job_id: uuid.UUID) -> int:
    """
    Start parsing for as many pending candidates as slots allow.

    Claims a slot immediately by setting parse_status to `parsing` before
    enqueueing Celery so the UI moves resumes out of the Upload queue at once.
    """
    active = await _count_active_parses(session, job_id)
    max_concurrent = settings.MAX_CONCURRENT_PARSES
    slots = max(0, max_concurrent - active)

    if slots <= 0:
        logger.debug(
            "dispatch_parse_slots: job=%s no slots (active=%d max=%d)",
            job_id,
            active,
            max_concurrent,
        )
        return 0

    result = await session.execute(
        select(Candidate)
        .where(
            Candidate.job_id == job_id,
            Candidate.parse_status == "pending_parse",
        )
        .order_by(Candidate.created_at.asc())
    )
    pending = result.scalars().all()

    from app.tasks.resume_tasks import extract_resume_text  # noqa: PLC0415

    dispatched = 0
    for candidate in pending:
        if dispatched >= slots:
            break
        candidate.parse_status = "parsing"
        await session.flush()
        extract_resume_text.apply_async(args=[str(candidate.id)])
        dispatched += 1
        logger.info("dispatch_parse_slots: started parsing for candidate %s", candidate.id)

    if dispatched:
        await session.commit()
        logger.info(
            "dispatch_parse_slots: job=%s dispatched=%d (active_was=%d)",
            job_id,
            dispatched,
            active,
        )

    return dispatched


def dispatch_parse_slots_after_complete(job_id: str) -> None:
    """Celery-safe entry: open a DB session and fill freed parse slots."""

    async def _run() -> None:
        async with get_celery_db() as session:
            await dispatch_parse_slots(session, uuid.UUID(job_id))

    asyncio.run(_run())
