"""
Shortlist Tasks — Sprint 4

Celery task for batch AI shortlisting of candidates.
"""

import asyncio
import logging

import redis as redis_lib

from app.core.celery_app import celery_app
from app.core.config_loader import config
from app.core.database import get_celery_db
from app.services.shortlist_batch_store import ShortlistBatchStore
from app.services.shortlist_processing_service import (
    ShortlistBatchOutcome,
    ShortlistProcessingService,
)

logger = logging.getLogger(__name__)


@celery_app.task(
    name="tasks.run_shortlist",
    bind=True,
    max_retries=config.celery.default_max_retries,
)
def run_shortlist(
    self,
    job_id: str,
    candidate_ids: list[str] | None = None,
    force: bool = False,
):
    """
    Celery task: run AI shortlisting for ready candidates in a job.

    Enqueued by POST /api/jobs/{job_id}/shortlist.
    """
    retrying = False
    try:
        asyncio.run(_async_shortlist(self, job_id, candidate_ids, force=force))
    except Exception as exc:
        from celery.exceptions import Retry

        if isinstance(exc, Retry):
            retrying = True
            logger.warning(
                "run_shortlist retry scheduled for job %s — keeping Redis lock",
                job_id,
            )
        else:
            logger.error("run_shortlist failed for job %s: %s", job_id, exc)
        raise
    finally:
        if retrying:
            return
        try:
            ShortlistBatchStore().release_lock(job_id)
        except Exception as lock_exc:
            logger.warning(
                "run_shortlist: failed to release Redis lock for job %s: %s",
                job_id,
                lock_exc,
            )


async def _async_shortlist(
    task_self,
    job_id: str,
    candidate_ids: list[str] | None = None,
    *,
    force: bool = False,
) -> None:
    batch_store = ShortlistBatchStore()
    async with get_celery_db() as session:
        result = await ShortlistProcessingService(
            session, batch_store=batch_store
        ).run_batch(job_id, candidate_ids, force=force)

    if result.outcome == ShortlistBatchOutcome.RETRY_RATE_LIMIT:
        raise task_self.retry(
            exc=result.error, countdown=config.celery.rate_limit_countdown_sec
        )
    if result.outcome == ShortlistBatchOutcome.RETRY_CONNECTION:
        raise task_self.retry(
            exc=result.error, countdown=config.celery.transient_countdown_sec
        )
    if result.outcome == ShortlistBatchOutcome.RETRY_TRANSIENT:
        raise task_self.retry(
            exc=result.error, countdown=config.celery.transient_countdown_sec
        )
