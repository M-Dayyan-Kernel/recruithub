"""Celery worker orchestration for resume AI processing."""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.models.models import Candidate, Job
from app.services.combined_shortlist_service import CombinedShortlistService
from app.services.document_extractor import UnsupportedDocumentError
from app.services.processing_queue_service import ProcessingQueueService
from app.services.tenant_integrations_service import load_tenant_integrations

logger = logging.getLogger(__name__)


class ProcessingOutcome(str, Enum):
    SKIPPED = "skipped"
    COMPLETED = "completed"
    FAILED_NO_RETRY = "failed_no_retry"
    RETRY_RATE_LIMIT = "retry_rate_limit"
    RETRY_CONNECTION = "retry_connection"
    RETRY_TRANSIENT = "retry_transient"


RETRY_OUTCOMES = (
    ProcessingOutcome.RETRY_RATE_LIMIT,
    ProcessingOutcome.RETRY_CONNECTION,
    ProcessingOutcome.RETRY_TRANSIENT,
)

RETRIES_EXHAUSTED_PREFIX = "Retries exhausted"
INSUFFICIENT_QUOTA_PREFIX = "insufficient_quota"


def retry_countdown(outcome: ProcessingOutcome) -> int:
    if outcome == ProcessingOutcome.RETRY_RATE_LIMIT:
        return config.celery.rate_limit_countdown_sec
    return config.celery.transient_countdown_sec


def is_quota_exhausted(exc: BaseException) -> bool:
    """An OpenAI 429 that is an empty account, not a busy one: waiting will not fix it."""
    if getattr(exc, "code", None) == "insufficient_quota":
        return True
    text = str(exc).lower()
    return "insufficient_quota" in text or "exceeded your current quota" in text


@dataclass
class ProcessingResult:
    outcome: ProcessingOutcome
    error: Exception | None = None
    #: Seconds until the automatic retry, set only for a retry outcome.
    countdown: int | None = None


class ResumeProcessingService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        combined_shortlist: CombinedShortlistService | None = None,
        queue_service: ProcessingQueueService | None = None,
    ) -> None:
        self._session = session
        self._combined = combined_shortlist or CombinedShortlistService()
        self._queue = queue_service or ProcessingQueueService(session)

    async def process_candidate(
        self, candidate_id: str, token: str | None = None
    ) -> ProcessingResult:
        """Run one attempt for a resume.

        `token` is the one dispatch_slots stored on the row when it sent this task. A different
        token means this message is stale (a newer send replaced it) and it does nothing. None
        is accepted for messages queued before tokens existed.
        """
        import openai
        from pydantic import ValidationError

        result = await self._session.execute(
            select(Candidate).where(Candidate.id == uuid.UUID(candidate_id))
        )
        candidate = result.scalar_one_or_none()
        if not candidate:
            logger.warning(
                "process_resume_shortlist: candidate %s not found — skipping",
                candidate_id,
            )
            return ProcessingResult(ProcessingOutcome.SKIPPED)

        if candidate.pipeline_status not in ("queued", "processing"):
            logger.info(
                "process_resume_shortlist: candidate %s status=%s — skipping",
                candidate_id,
                candidate.pipeline_status,
            )
            return ProcessingResult(ProcessingOutcome.SKIPPED)

        if token is not None and token != candidate.processing_token:
            logger.info(
                "process_resume_shortlist: candidate %s has a newer dispatch — skipping stale task",
                candidate_id,
            )
            return ProcessingResult(ProcessingOutcome.SKIPPED)

        job_id = candidate.job_id
        candidate.pipeline_status = "processing"
        candidate.pipeline_error = None
        candidate.processing_attempts = (candidate.processing_attempts or 0) + 1
        # Per attempt, so the stuck check measures this attempt and not the first one.
        candidate.processing_started_at = datetime.now(timezone.utc)
        candidate.processing_retry_at = None
        await self._session.commit()

        try:
            job_result = await self._session.execute(select(Job).where(Job.id == job_id))
            job = job_result.scalar_one_or_none()
            if not job:
                exc = ValueError(f"Job {job_id} not found")
                await self._mark_failed(candidate, job_id, exc)
                return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

            integrations = await load_tenant_integrations(self._session, job.tenant_id)
            integrations.require("openai_api_key")

            await self._combined.process(
                self._session,
                candidate,
                job,
                integrations.openai_api_key,
            )
            candidate.pipeline_status = "completed"
            candidate.pipeline_error = None
            candidate.processing_started_at = None
            candidate.processing_retry_at = None
            await self._session.commit()
            logger.info(
                "AI review completed for candidate %s (%s)",
                candidate_id,
                candidate.name or candidate.original_filename,
            )
            return ProcessingResult(ProcessingOutcome.COMPLETED)

        except UnsupportedDocumentError as exc:
            logger.warning(
                "process_resume_shortlist: unsupported document for %s — %s",
                candidate_id,
                exc,
            )
            await self._mark_failed(candidate, job_id, exc)
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        except FileNotFoundError as exc:
            logger.error(
                "process_resume_shortlist: file not found for %s — %s",
                candidate_id,
                exc,
            )
            await self._mark_failed(candidate, job_id, exc)
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        except (json.JSONDecodeError, ValidationError) as exc:
            # A malformed model reply. Both are ValueError subclasses, so without this clause
            # they fell into the permanent branch below, though the next reply is usually fine.
            logger.warning(
                "process_resume_shortlist: malformed AI reply for %s — %s",
                candidate_id,
                exc,
            )
            return await self._retry_or_give_up(
                candidate, job_id, ProcessingOutcome.RETRY_TRANSIENT, exc
            )

        except ValueError as exc:
            logger.warning(
                "process_resume_shortlist: invalid input for %s — %s",
                candidate_id,
                exc,
            )
            await self._mark_failed(candidate, job_id, exc)
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        except openai.AuthenticationError as exc:
            logger.error(
                "OpenAI auth failed for candidate %s: %s", candidate_id, exc
            )
            await self._mark_failed(candidate, job_id, exc)
            return ProcessingResult(ProcessingOutcome.SKIPPED, exc)

        except openai.RateLimitError as exc:
            if is_quota_exhausted(exc):
                logger.error(
                    "OpenAI quota exhausted for candidate %s: %s", candidate_id, exc
                )
                await self._mark_failed(
                    candidate, job_id, f"{INSUFFICIENT_QUOTA_PREFIX}: {exc}"
                )
                return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)
            logger.warning(
                "OpenAI rate limited for candidate %s: %s", candidate_id, exc
            )
            return await self._retry_or_give_up(
                candidate, job_id, ProcessingOutcome.RETRY_RATE_LIMIT, exc
            )

        except openai.APIConnectionError as exc:
            logger.warning(
                "OpenAI connection error for candidate %s: %s", candidate_id, exc
            )
            return await self._retry_or_give_up(
                candidate, job_id, ProcessingOutcome.RETRY_CONNECTION, exc
            )

        except openai.NotFoundError as exc:
            logger.error(
                "OpenAI model/endpoint not found for candidate %s: %s",
                candidate_id,
                exc,
            )
            await self._mark_failed(candidate, job_id, exc)
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        except Exception as exc:
            logger.error(
                "Unexpected error processing candidate %s: %s", candidate_id, exc
            )
            return await self._retry_or_give_up(
                candidate, job_id, ProcessingOutcome.RETRY_TRANSIENT, exc
            )

        finally:
            await self._queue.dispatch_slots(job_id)

    async def _retry_or_give_up(
        self,
        candidate: Candidate,
        job_id: uuid.UUID,
        outcome: ProcessingOutcome,
        exc: Exception,
    ) -> ProcessingResult:
        """Schedule the next attempt, or fail the resume once it has had all of them.

        Without the cap a resume that kept failing stayed `processing` when Celery ran out of
        retries, and recovery sent it again every few minutes, forever.
        """
        from app.services.processing_queue_service import MAX_PROCESSING_ATTEMPTS

        # The failed attempt may have left the session in a broken transaction (a database
        # error) or with half-applied profile fields. Drop both and reload the row as committed
        # at attempt start; an async session cannot lazy-load the expired attributes.
        await self._session.rollback()
        await self._session.refresh(candidate)
        if (candidate.processing_attempts or 0) >= MAX_PROCESSING_ATTEMPTS:
            await self._mark_failed(
                candidate,
                job_id,
                f"{RETRIES_EXHAUSTED_PREFIX} after {candidate.processing_attempts} attempts: {exc}",
            )
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        countdown = retry_countdown(outcome)
        candidate.processing_retry_at = datetime.now(timezone.utc) + timedelta(seconds=countdown)
        await self._session.commit()
        return ProcessingResult(outcome, exc, countdown)

    async def _mark_failed(
        self, candidate: Candidate, job_id: uuid.UUID, error: Exception | str
    ) -> None:
        candidate.pipeline_status = "failed"
        candidate.pipeline_error = str(error)[:2000]
        candidate.processing_started_at = None
        candidate.processing_retry_at = None
        await self._session.commit()
        await self._queue.dispatch_slots(job_id)


async def mark_processing_exhausted(
    session: AsyncSession, candidate_id: str, error: BaseException
) -> None:
    """Fail a resume whose task crashed outside the service until Celery gave up.

    The service handles its own errors; this is for the rest (a database error, say), which
    used to leave the row `processing` with nothing left to finish it.
    """
    result = await session.execute(
        select(Candidate).where(Candidate.id == uuid.UUID(candidate_id))
    )
    candidate = result.scalar_one_or_none()
    if candidate is None or candidate.pipeline_status not in ("queued", "processing"):
        return
    await ResumeProcessingService(session)._mark_failed(
        candidate,
        candidate.job_id,
        f"{RETRIES_EXHAUSTED_PREFIX}: {error}",
    )
