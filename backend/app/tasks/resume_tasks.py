import asyncio
import logging

from celery.exceptions import Retry

from app.core.celery_app import celery_app
from app.core.config_loader import config
from app.core.database import get_celery_db
from app.services.processing_queue_service import recover_stuck_processing
from app.services.resume_processing_service import (
    ProcessingOutcome,
    ResumeProcessingService,
)

logger = logging.getLogger(__name__)


class _NoRetryError(Exception):
    """Abort Celery retry for unrecoverable errors."""


@celery_app.task(
    name="tasks.process_resume_shortlist",
    bind=True,
    max_retries=config.celery.default_max_retries,
)
def process_resume_shortlist(self, candidate_id: str):
    """Extract resume, run combined AI profile+shortlist, persist results."""
    try:
        asyncio.run(_async_process_resume_shortlist(self, candidate_id))
    except _NoRetryError as exc:
        logger.error(
            "process_resume_shortlist: unrecoverable failure for candidate %s: %s",
            candidate_id,
            exc,
        )
    except Retry:
        raise
    except Exception as exc:
        logger.error(
            "process_resume_shortlist failed for candidate %s: %s", candidate_id, exc
        )
        raise self.retry(exc=exc, countdown=config.celery.extraction_countdown_sec)


async def _async_process_resume_shortlist(task, candidate_id: str) -> None:
    async with get_celery_db() as session:
        result = await ResumeProcessingService(session).process_candidate(candidate_id)

    if result.outcome == ProcessingOutcome.FAILED_NO_RETRY:
        raise _NoRetryError(str(result.error or f"Unrecoverable failure for {candidate_id}"))
    if result.outcome == ProcessingOutcome.RETRY_RATE_LIMIT:
        raise task.retry(exc=result.error, countdown=config.celery.rate_limit_countdown_sec)
    if result.outcome == ProcessingOutcome.RETRY_CONNECTION:
        raise task.retry(exc=result.error, countdown=config.celery.transient_countdown_sec)
    if result.outcome == ProcessingOutcome.RETRY_TRANSIENT:
        raise task.retry(exc=result.error, countdown=config.celery.transient_countdown_sec)


@celery_app.task(name="tasks.recover_stuck_resume_processing")
def recover_stuck_resume_processing():
    """Periodic recovery for candidates stuck in processing after a worker crash."""
    try:
        asyncio.run(_async_recover_stuck())
    except Exception as exc:
        logger.error("recover_stuck_resume_processing failed: %s", exc)


async def _async_recover_stuck() -> None:
    async with get_celery_db() as session:
        recovered = await recover_stuck_processing(session)
        if recovered:
            logger.info(
                "recover_stuck_resume_processing: recovered %d candidates", recovered
            )
