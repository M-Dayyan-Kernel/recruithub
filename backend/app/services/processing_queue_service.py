"""
Processing queue — limits concurrent resume AI processing per job.

Candidates in `queued` wait until a slot opens; `processing` counts against the cap.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.logging import log_event, plural
from app.models.models import Candidate

logger = logging.getLogger(__name__)

ACTIVE_PROCESSING_STATUSES = ("processing",)
STUCK_PROCESSING_TIMEOUT = timedelta(
    minutes=config.concurrency.stuck_parse_timeout_minutes
)


class ProcessingQueueService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def dispatch_slots(self, job_id: uuid.UUID) -> int:
        """Start AI processing for queued candidates up to the concurrency limit."""
        await self.recover_stuck(job_id)

        active = await self._count_active_processing(job_id)
        max_concurrent = config.concurrency.max_resume_processing
        slots = max(0, max_concurrent - active)
        if slots <= 0:
            return 0

        result = await self._session.execute(
            select(Candidate)
            .where(
                Candidate.job_id == job_id,
                Candidate.pipeline_status == "queued",
                Candidate.skip_ai_shortlist.is_(False),
            )
            .order_by(Candidate.created_at.asc())
            .limit(slots)
            .with_for_update(skip_locked=True)
        )
        pending = result.scalars().all()

        from app.tasks.resume_tasks import process_resume_shortlist  # noqa: PLC0415

        dispatched = 0
        now = datetime.now(timezone.utc)
        for candidate in pending:
            candidate.pipeline_status = "processing"
            candidate.processing_started_at = now
            await self._session.flush()
            process_resume_shortlist.apply_async(args=[str(candidate.id)])
            dispatched += 1

        if dispatched:
            await self._session.commit()
            log_event(
                logger,
                "Started AI review for %s",
                plural(dispatched, "resume"),
            )
        return dispatched

    async def recover_stuck(self, job_id: uuid.UUID | None = None) -> int:
        """Re-enqueue candidates stuck in processing longer than the timeout."""
        cutoff = datetime.now(timezone.utc) - STUCK_PROCESSING_TIMEOUT
        query = (
            select(Candidate)
            .where(
                Candidate.pipeline_status == "processing",
                Candidate.processing_started_at.is_not(None),
                Candidate.processing_started_at < cutoff,
            )
            .order_by(Candidate.processing_started_at.asc())
        )
        if job_id is not None:
            query = query.where(Candidate.job_id == job_id)

        result = await self._session.execute(query)
        stuck = result.scalars().all()
        if not stuck:
            return 0

        from app.tasks.resume_tasks import process_resume_shortlist  # noqa: PLC0415

        recovered = 0
        now = datetime.now(timezone.utc)
        for candidate in stuck:
            label = candidate.original_filename or candidate.name or "a candidate"
            logger.warning("Re-queueing stuck AI processing for %s", label)
            candidate.pipeline_status = "queued"
            candidate.processing_started_at = now
            await self._session.flush()
            process_resume_shortlist.apply_async(args=[str(candidate.id)])
            recovered += 1

        if recovered:
            await self._session.commit()
            log_event(
                logger,
                "Recovered %s stuck in AI processing",
                plural(recovered, "resume"),
            )
        return recovered

    async def enqueue(
        self, candidate_id: uuid.UUID, job_id: uuid.UUID
    ) -> None:
        """Mark candidate queued and try to dispatch a processing slot."""
        result = await self._session.execute(
            select(Candidate).where(Candidate.id == candidate_id)
        )
        candidate = result.scalar_one_or_none()
        if not candidate:
            return
        candidate.pipeline_status = "queued"
        if candidate.processing_started_at is None:
            candidate.processing_started_at = datetime.now(timezone.utc)
        await self._session.flush()
        await self.dispatch_slots(job_id)

    async def _count_active_processing(self, job_id: uuid.UUID) -> int:
        result = await self._session.execute(
            select(func.count())
            .select_from(Candidate)
            .where(
                Candidate.job_id == job_id,
                Candidate.pipeline_status.in_(ACTIVE_PROCESSING_STATUSES),
            )
        )
        return int(result.scalar() or 0)


async def dispatch_processing_slots(session: AsyncSession, job_id: uuid.UUID) -> int:
    return await ProcessingQueueService(session).dispatch_slots(job_id)


async def recover_stuck_processing(
    session: AsyncSession, job_id: uuid.UUID | None = None
) -> int:
    return await ProcessingQueueService(session).recover_stuck(job_id)


async def enqueue_candidate_processing(
    session: AsyncSession, candidate_id: uuid.UUID, job_id: uuid.UUID
) -> None:
    await ProcessingQueueService(session).enqueue(candidate_id, job_id)
