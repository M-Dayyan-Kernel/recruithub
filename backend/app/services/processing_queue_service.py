"""
Processing queue — limits concurrent resume AI processing per job.

Candidates in `queued` wait until a slot opens; `processing` counts against the cap.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.logging import log_event, plural
from app.models.models import Candidate

logger = logging.getLogger(__name__)

ACTIVE_PROCESSING_STATUSES = ("processing",)
STUCK_PROCESSING_TIMEOUT = timedelta(
    minutes=config.concurrency.stuck_parse_timeout_minutes
)
#: Attempts a resume gets (the first plus the automatic retries) before it is marked failed.
#: Counted on the row, so recovery sending a fresh task does not reset it.
MAX_PROCESSING_ATTEMPTS = config.celery.default_max_retries + 1

STOPPED_REPEATEDLY_PREFIX = "Stopped repeatedly"


def new_processing_token() -> str:
    return uuid.uuid4().hex


def is_processing_stalled(candidate: Candidate, now: datetime | None = None) -> bool:
    """True when a `processing` row has gone quiet for longer than the stuck timeout.

    A row waiting for an automatic retry is stalled only once that retry is overdue: the wait
    itself (up to 5 minutes for a rate limit) is not a stuck attempt, and treating it as one used
    to send a second task alongside the pending retry.
    """
    if candidate.pipeline_status != "processing":
        return False
    cutoff = (now or datetime.now(timezone.utc)) - STUCK_PROCESSING_TIMEOUT
    if candidate.processing_retry_at is not None:
        return candidate.processing_retry_at < cutoff
    started = candidate.processing_started_at or candidate.pipeline_status_at
    return started is not None and started < cutoff


class ProcessingQueueService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def dispatch_slots(self, job_id: uuid.UUID) -> int:
        """Start AI processing for queued candidates up to the concurrency limit.

        The only place a resume task is sent. Each send carries a fresh token stored on the row,
        so any older message for the same resume still sitting in Redis does nothing when it runs.
        """
        await self._requeue_stuck(job_id)

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
            )
            .order_by(Candidate.created_at.asc())
            .limit(slots)
            .with_for_update(skip_locked=True)
        )
        pending = result.scalars().all()
        if not pending:
            return 0

        from app.tasks.resume_tasks import process_resume_shortlist  # noqa: PLC0415

        now = datetime.now(timezone.utc)
        sends: list[tuple[str, str]] = []
        for candidate in pending:
            token = new_processing_token()
            candidate.pipeline_status = "processing"
            candidate.processing_started_at = now
            candidate.processing_retry_at = None
            candidate.processing_token = token
            sends.append((str(candidate.id), token))

        # Commit before sending: a worker that picks the message up at once must already see
        # the row as processing with this token, or it would skip it as stale.
        await self._session.commit()
        for candidate_id, token in sends:
            process_resume_shortlist.apply_async(args=[candidate_id, token])

        log_event(
            logger,
            "Started AI review for %s",
            plural(len(sends), "resume"),
        )
        return len(sends)

    async def recover_stuck(self, job_id: uuid.UUID | None = None) -> int:
        """Put stalled resumes back in the queue (or fail them at the cap), then dispatch.

        Called by beat for every job. Sends nothing itself: dispatch_slots does, so a recovered
        resume can never be sent twice.
        """
        recovered, job_ids = await self._requeue_stuck(job_id)
        for affected_job_id in job_ids:
            await self.dispatch_slots(affected_job_id)
        return recovered

    async def _requeue_stuck(
        self, job_id: uuid.UUID | None = None
    ) -> tuple[int, set[uuid.UUID]]:
        """Database changes only. Returns how many were handled and the jobs they belong to."""
        now = datetime.now(timezone.utc)
        cutoff = now - STUCK_PROCESSING_TIMEOUT
        # A coarse filter in SQL; is_processing_stalled makes the exact call.
        query = (
            select(Candidate)
            .where(
                Candidate.pipeline_status == "processing",
                or_(
                    Candidate.processing_started_at < cutoff,
                    Candidate.processing_retry_at < cutoff,
                ),
            )
            .order_by(Candidate.processing_started_at.asc())
        )
        if job_id is not None:
            query = query.where(Candidate.job_id == job_id)

        result = await self._session.execute(query)
        stuck = [c for c in result.scalars().all() if is_processing_stalled(c, now)]
        if not stuck:
            return 0, set()

        requeued = 0
        failed = 0
        job_ids: set[uuid.UUID] = set()
        for candidate in stuck:
            label = candidate.original_filename or candidate.name or "a candidate"
            job_ids.add(candidate.job_id)
            candidate.processing_retry_at = None
            candidate.processing_token = None
            if (candidate.processing_attempts or 0) >= MAX_PROCESSING_ATTEMPTS:
                # It started the full number of times and never finished: a file that crashes
                # the worker, or a worker that keeps dying. Requeueing again would loop forever.
                logger.warning("Giving up on AI processing for %s after repeated stalls", label)
                candidate.pipeline_status = "failed"
                candidate.pipeline_error = (
                    f"{STOPPED_REPEATEDLY_PREFIX}: no result after "
                    f"{candidate.processing_attempts} attempts"
                )
                candidate.processing_started_at = None
                failed += 1
            else:
                logger.warning("Re-queueing stuck AI processing for %s", label)
                candidate.pipeline_status = "queued"
                candidate.processing_started_at = None
                requeued += 1

        await self._session.commit()
        if requeued:
            log_event(
                logger,
                "Recovered %s stuck in AI processing",
                plural(requeued, "resume"),
            )
        if failed:
            log_event(
                logger,
                "Marked %s failed after repeated stalls",
                plural(failed, "resume"),
            )
        return requeued + failed, job_ids

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
