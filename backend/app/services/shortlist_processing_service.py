"""Celery worker orchestration for batch shortlisting."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from enum import Enum

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import log_event, plural
from app.services.combined_shortlist_service import CombinedShortlistService
from app.services.shortlist_batch_store import ShortlistBatchStore

logger = logging.getLogger(__name__)


class ShortlistBatchOutcome(str, Enum):
    COMPLETED = "completed"
    AUTH_FAILED = "auth_failed"
    JOB_NOT_FOUND = "job_not_found"
    RETRY_RATE_LIMIT = "retry_rate_limit"
    RETRY_CONNECTION = "retry_connection"
    RETRY_TRANSIENT = "retry_transient"


@dataclass
class ShortlistBatchResult:
    outcome: ShortlistBatchOutcome
    error: Exception | None = None


class ShortlistProcessingService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        batch_store: ShortlistBatchStore | None = None,
        combined_shortlist: CombinedShortlistService | None = None,
    ) -> None:
        self._session = session
        self._batch_store = batch_store or ShortlistBatchStore()
        self._combined = combined_shortlist or CombinedShortlistService()

    async def run_batch(
        self,
        job_id: str,
        candidate_ids: list[str] | None = None,
        *,
        force: bool = False,
    ) -> ShortlistBatchResult:
        import openai

        batch_ids = self._batch_store.load_batch_ids(job_id, candidate_ids)
        if batch_ids:
            log_event(
                logger,
                "Shortlisting worker started for %s%s",
                plural(len(batch_ids), "candidate"),
                " (force re-score)" if force else "",
            )
        else:
            log_event(
                logger,
                "Shortlisting worker started for all ready candidates on this job",
            )

        try:
            results, failed_count = await self._combined.batch_rescore(
                uuid.UUID(job_id),
                self._session,
                candidate_ids=batch_ids if batch_ids else None,
                force=force,
            )
            self._batch_store.store_failed_count(job_id, failed_count)
            by_rec: dict[str, int] = {}
            for record in results:
                by_rec[record.recommendation] = by_rec.get(record.recommendation, 0) + 1
            log_event(
                logger,
                "Shortlisting finished — %s shortlisted, %s marked for review, %s rejected%s",
                plural(by_rec.get("shortlisted", 0), "candidate"),
                plural(by_rec.get("review", 0), "candidate"),
                plural(by_rec.get("rejected", 0), "candidate"),
                f", {plural(failed_count, 'failure')}" if failed_count else "",
            )
            return ShortlistBatchResult(ShortlistBatchOutcome.COMPLETED)

        except openai.AuthenticationError as exc:
            logger.error(
                "OpenAI API key invalid — cannot shortlist job %s: %s", job_id, exc
            )
            return ShortlistBatchResult(ShortlistBatchOutcome.AUTH_FAILED, exc)

        except openai.RateLimitError as exc:
            logger.warning(
                "OpenAI rate limit hit shortlisting job %s — will retry in 300s: %s",
                job_id,
                exc,
            )
            return ShortlistBatchResult(ShortlistBatchOutcome.RETRY_RATE_LIMIT, exc)

        except openai.APIConnectionError as exc:
            logger.warning(
                "OpenAI connection error shortlisting job %s — will retry in 120s: %s",
                job_id,
                exc,
            )
            return ShortlistBatchResult(ShortlistBatchOutcome.RETRY_CONNECTION, exc)

        except ValueError as exc:
            logger.error(
                "run_shortlist: job %s not found — aborting (no retry): %s", job_id, exc
            )
            return ShortlistBatchResult(ShortlistBatchOutcome.JOB_NOT_FOUND, exc)

        except Exception as exc:
            logger.error(
                "run_shortlist: unexpected error for job %s — will retry: %s", job_id, exc
            )
            return ShortlistBatchResult(ShortlistBatchOutcome.RETRY_TRANSIENT, exc)
