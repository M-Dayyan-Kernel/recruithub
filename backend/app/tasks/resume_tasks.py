import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.config_loader import config
from app.core.database import get_celery_db
from app.models.models import Candidate, Job
from app.services.combined_shortlist_service import process_candidate_resume_shortlist
from app.services.document_extractor import UnsupportedDocumentError
from app.services.processing_queue_service import dispatch_processing_slots
from app.services.tenant_integrations_service import load_tenant_integrations

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
        asyncio.run(_async_process_resume_shortlist(candidate_id))
    except _NoRetryError:
        pass
    except Exception as exc:
        logger.error(
            "process_resume_shortlist failed for candidate %s: %s", candidate_id, exc
        )
        raise self.retry(exc=exc, countdown=config.celery.extraction_countdown_sec)


async def _async_process_resume_shortlist(candidate_id: str) -> None:
    import openai

    async with get_celery_db() as session:
        result = await session.execute(
            select(Candidate).where(Candidate.id == uuid.UUID(candidate_id))
        )
        candidate = result.scalar_one_or_none()
        if not candidate:
            logger.warning(
                "process_resume_shortlist: candidate %s not found — skipping",
                candidate_id,
            )
            return

        if candidate.pipeline_status not in ("queued", "processing"):
            logger.info(
                "process_resume_shortlist: candidate %s status=%s — skipping",
                candidate_id,
                candidate.pipeline_status,
            )
            return

        job_id = candidate.job_id
        candidate.pipeline_status = "processing"
        if candidate.processing_started_at is None:
            candidate.processing_started_at = datetime.now(timezone.utc)
        await session.commit()

        try:
            job_result = await session.execute(select(Job).where(Job.id == job_id))
            job = job_result.scalar_one_or_none()
            if not job:
                raise _NoRetryError(f"Job {job_id} not found")

            integrations = await load_tenant_integrations(session, job.tenant_id)
            integrations.require("openai_api_key")

            await process_candidate_resume_shortlist(
                session,
                candidate,
                job,
                integrations.openai_api_key,
            )
            candidate.pipeline_status = "completed"
            candidate.processing_started_at = None
            await session.commit()
            logger.info(
                "AI review completed for candidate %s (%s)",
                candidate_id,
                candidate.name or candidate.original_filename,
            )

        except UnsupportedDocumentError as exc:
            logger.warning(
                "process_resume_shortlist: unsupported document for %s — %s",
                candidate_id,
                exc,
            )
            candidate.pipeline_status = "failed"
            candidate.processing_started_at = None
            await session.commit()
            await dispatch_processing_slots(session, job_id)
            raise _NoRetryError(str(exc)) from exc

        except FileNotFoundError as exc:
            logger.error(
                "process_resume_shortlist: file not found for %s — %s",
                candidate_id,
                exc,
            )
            candidate.pipeline_status = "failed"
            candidate.processing_started_at = None
            await session.commit()
            await dispatch_processing_slots(session, job_id)
            raise _NoRetryError(str(exc)) from exc

        except ValueError as exc:
            logger.warning(
                "process_resume_shortlist: invalid input for %s — %s",
                candidate_id,
                exc,
            )
            candidate.pipeline_status = "failed"
            candidate.processing_started_at = None
            await session.commit()
            await dispatch_processing_slots(session, job_id)
            raise _NoRetryError(str(exc)) from exc

        except openai.AuthenticationError as exc:
            logger.error(
                "OpenAI auth failed for candidate %s: %s", candidate_id, exc
            )
            candidate.pipeline_status = "failed"
            candidate.processing_started_at = None
            await session.commit()
            await dispatch_processing_slots(session, job_id)
            return

        except openai.RateLimitError as exc:
            candidate.pipeline_status = "queued"
            await session.commit()
            raise process_resume_shortlist.retry(
                exc=exc, countdown=config.celery.rate_limit_countdown_sec
            )

        except openai.APIConnectionError as exc:
            candidate.pipeline_status = "queued"
            await session.commit()
            raise process_resume_shortlist.retry(
                exc=exc, countdown=config.celery.transient_countdown_sec
            )

        except Exception as exc:
            logger.error(
                "Unexpected error processing candidate %s: %s", candidate_id, exc
            )
            candidate.pipeline_status = "queued"
            await session.commit()
            raise process_resume_shortlist.retry(
                exc=exc, countdown=config.celery.transient_countdown_sec
            )

        finally:
            await dispatch_processing_slots(session, job_id)


@celery_app.task(name="tasks.recover_stuck_resume_processing")
def recover_stuck_resume_processing():
    """Periodic recovery for candidates stuck in processing after a worker crash."""
    try:
        asyncio.run(_async_recover_stuck())
    except Exception as exc:
        logger.error("recover_stuck_resume_processing failed: %s", exc)


async def _async_recover_stuck() -> None:
    from app.services.processing_queue_service import recover_stuck_processing

    async with get_celery_db() as session:
        recovered = await recover_stuck_processing(session)
        if recovered:
            logger.info(
                "recover_stuck_resume_processing: recovered %d candidates", recovered
            )
