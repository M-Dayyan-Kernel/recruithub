"""Celery worker orchestration for resume AI processing."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


@dataclass
class ProcessingResult:
    outcome: ProcessingOutcome
    error: Exception | None = None


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

    async def process_candidate(self, candidate_id: str) -> ProcessingResult:
        import openai

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

        job_id = candidate.job_id
        candidate.pipeline_status = "processing"
        if candidate.processing_started_at is None:
            candidate.processing_started_at = datetime.now(timezone.utc)
        await self._session.commit()

        try:
            job_result = await self._session.execute(select(Job).where(Job.id == job_id))
            job = job_result.scalar_one_or_none()
            if not job:
                return ProcessingResult(
                    ProcessingOutcome.FAILED_NO_RETRY,
                    ValueError(f"Job {job_id} not found"),
                )

            integrations = await load_tenant_integrations(self._session, job.tenant_id)
            integrations.require("openai_api_key")

            await self._combined.process(
                self._session,
                candidate,
                job,
                integrations.openai_api_key,
            )
            candidate.pipeline_status = "completed"
            candidate.processing_started_at = None
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
            await self._mark_failed(candidate, job_id)
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        except FileNotFoundError as exc:
            logger.error(
                "process_resume_shortlist: file not found for %s — %s",
                candidate_id,
                exc,
            )
            await self._mark_failed(candidate, job_id)
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        except ValueError as exc:
            logger.warning(
                "process_resume_shortlist: invalid input for %s — %s",
                candidate_id,
                exc,
            )
            await self._mark_failed(candidate, job_id)
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        except openai.AuthenticationError as exc:
            logger.error(
                "OpenAI auth failed for candidate %s: %s", candidate_id, exc
            )
            await self._mark_failed(candidate, job_id)
            return ProcessingResult(ProcessingOutcome.SKIPPED)

        except openai.RateLimitError as exc:
            logger.warning(
                "OpenAI rate limited for candidate %s: %s", candidate_id, exc
            )
            return ProcessingResult(ProcessingOutcome.RETRY_RATE_LIMIT, exc)

        except openai.APIConnectionError as exc:
            logger.warning(
                "OpenAI connection error for candidate %s: %s", candidate_id, exc
            )
            return ProcessingResult(ProcessingOutcome.RETRY_CONNECTION, exc)

        except openai.NotFoundError as exc:
            logger.error(
                "OpenAI model/endpoint not found for candidate %s: %s",
                candidate_id,
                exc,
            )
            await self._mark_failed(candidate, job_id)
            return ProcessingResult(ProcessingOutcome.FAILED_NO_RETRY, exc)

        except Exception as exc:
            logger.error(
                "Unexpected error processing candidate %s: %s", candidate_id, exc
            )
            return ProcessingResult(ProcessingOutcome.RETRY_TRANSIENT, exc)

        finally:
            await self._queue.dispatch_slots(job_id)

    async def _mark_failed(self, candidate: Candidate, job_id: uuid.UUID) -> None:
        candidate.pipeline_status = "failed"
        candidate.processing_started_at = None
        await self._session.commit()
        await self._queue.dispatch_slots(job_id)
