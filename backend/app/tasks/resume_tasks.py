import asyncio
import logging

from celery.exceptions import Retry

from app.core.celery_app import celery_app
from app.core.config_loader import config
from app.core.database import get_celery_db
from app.services.processing_queue_service import recover_stuck_processing
from app.services.resume_processing_service import (
    RETRY_OUTCOMES,
    ProcessingOutcome,
    ResumeProcessingService,
    mark_processing_exhausted,
)

logger = logging.getLogger(__name__)


class _NoRetryError(Exception):
    """Abort Celery retry for unrecoverable errors."""


@celery_app.task(
    name="tasks.process_resume_shortlist",
    bind=True,
    max_retries=config.celery.default_max_retries,
)
def process_resume_shortlist(self, candidate_id: str, dispatch_token: str | None = None):
    """Extract resume, run combined AI profile+shortlist, persist results.

    `dispatch_token` is the token dispatch_slots stored on the row; retries reuse the same args,
    so it survives them. Messages sent before tokens existed carry none and still run.
    """
    try:
        asyncio.run(_async_process_resume_shortlist(self, candidate_id, dispatch_token))
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
        if self.request.retries >= self.max_retries:
            # Out of retries: fail the row instead of re-raising, which left it `processing`
            # for recovery to resend forever.
            try:
                asyncio.run(_async_mark_exhausted(candidate_id, exc))
            except Exception as mark_exc:  # noqa: BLE001
                logger.error(
                    "process_resume_shortlist: could not mark %s failed: %s",
                    candidate_id,
                    mark_exc,
                )
            return
        raise self.retry(exc=exc, countdown=config.celery.extraction_countdown_sec)


async def _async_process_resume_shortlist(
    task, candidate_id: str, dispatch_token: str | None = None
) -> None:
    async with get_celery_db() as session:
        result = await ResumeProcessingService(session).process_candidate(
            candidate_id, dispatch_token
        )

    if result.outcome == ProcessingOutcome.FAILED_NO_RETRY:
        raise _NoRetryError(str(result.error or f"Unrecoverable failure for {candidate_id}"))
    if result.outcome in RETRY_OUTCOMES:
        # The service already counted the attempt against the cap and stamped the retry time
        # HR sees, so the countdown here must be the one it used.
        raise task.retry(exc=result.error, countdown=result.countdown)


async def _async_mark_exhausted(candidate_id: str, exc: BaseException) -> None:
    async with get_celery_db() as session:
        await mark_processing_exhausted(session, candidate_id, exc)


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
