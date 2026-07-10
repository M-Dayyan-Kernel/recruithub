"""
Parse queue — limits concurrent resume parsing per job.

Only up to MAX_CONCURRENT_PARSES candidates may be in `parse_queued`, `parsing`, or
`parsed` at once. Additional `pending_parse` candidates wait in the Upload queue until
a slot opens.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Candidate

logger = logging.getLogger(__name__)

ACTIVE_PARSE_STATUSES = ("parse_queued", "parsing", "parsed")

# If a worker dies mid-task, status can stay in parse_queued/parsing forever.
# Re-enqueue after this age so the pipeline can recover without manual intervention.
STUCK_PARSE_TIMEOUT = timedelta(minutes=5)


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


async def recover_stuck_parses(session: AsyncSession, job_id: uuid.UUID | None = None) -> int:
    """
    Re-queue candidates stuck in parse_queued/parsing longer than STUCK_PARSE_TIMEOUT.

    A previous Celery worker may have set status to parsing then crashed; the task is
    gone from Redis and will never complete without recovery.
    """
    cutoff = datetime.now(timezone.utc) - STUCK_PARSE_TIMEOUT
    query = (
        select(Candidate)
        .where(
            Candidate.parse_status.in_(("parse_queued", "parsing")),
            Candidate.created_at < cutoff,
        )
        .order_by(Candidate.created_at.asc())
    )
    if job_id is not None:
        query = query.where(Candidate.job_id == job_id)

    result = await session.execute(query)
    stuck = result.scalars().all()
    if not stuck:
        return 0

    from app.tasks.resume_tasks import extract_resume_text  # noqa: PLC0415

    recovered = 0
    job_ids: set[uuid.UUID] = set()
    for candidate in stuck:
        logger.warning(
            "recover_stuck_parses: re-enqueueing candidate %s (status=%s created_at=%s)",
            candidate.id,
            candidate.parse_status,
            candidate.created_at,
        )
        candidate.parse_status = "parse_queued"
        await session.flush()
        extract_resume_text.apply_async(args=[str(candidate.id)])
        recovered += 1
        job_ids.add(candidate.job_id)

    if recovered:
        await session.commit()
        logger.info("recover_stuck_parses: recovered=%d jobs=%s", recovered, job_ids)

    return recovered


async def dispatch_parse_slots(session: AsyncSession, job_id: uuid.UUID) -> int:
    """
    Start parsing for as many pending candidates as slots allow.

    Claims a slot by setting parse_status to `parse_queued` before enqueueing Celery.
    Resumes stay in the Upload tab until a worker starts and moves them to `parsing`.
    """
    await recover_stuck_parses(session, job_id)

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
        candidate.parse_status = "parse_queued"
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
