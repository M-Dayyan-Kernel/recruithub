"""
Shortlist Tasks — Sprint 4

Celery task for batch AI shortlisting of candidates.
Follows exact same pattern as resume_tasks.py:
  - Sync Celery task wrapper → asyncio.run() → async inner function
  - get_celery_db() for NullPool DB sessions (critical on Windows event loop)
  - Explicit openai error handling with appropriate retry / no-retry decisions
"""

import asyncio
import json
import logging
import uuid
from typing import List, Optional

import redis as redis_lib

from app.core.celery_app import celery_app
from app.core.config_loader import config
from app.core.logging import log_event, plural
from app.core.database import get_celery_db

logger = logging.getLogger(__name__)

SHORTLIST_BATCH_TTL = config.concurrency.shortlist_batch_ttl_seconds


def _shortlist_lock_key(job_id: str) -> str:
    return f"shortlist_lock:{job_id}"


def _shortlist_batch_key(job_id: str) -> str:
    return f"shortlist_batch:{job_id}"


def _shortlist_failed_key(job_id: str) -> str:
    return f"shortlist_failed:{job_id}"


def _load_batch_candidate_ids(job_id: str, candidate_ids: Optional[List[str]]) -> List[uuid.UUID]:
    """Resolve candidate IDs from task args or Redis batch key."""
    if candidate_ids:
        return [uuid.UUID(cid) for cid in candidate_ids]
    try:
        _r = redis_lib.from_url(config.REDIS_URL or "redis://localhost:6379/0")
        batch_raw = _r.get(_shortlist_batch_key(job_id))
        if batch_raw:
            return [uuid.UUID(cid) for cid in json.loads(batch_raw)]
    except Exception as exc:
        logger.warning("run_shortlist: failed to read batch from Redis for job %s: %s", job_id, exc)
    return []


def _store_failed_count(job_id: str, failed_count: int) -> None:
    try:
        _r = redis_lib.from_url(config.REDIS_URL or "redis://localhost:6379/0")
        _r.set(_shortlist_failed_key(job_id), str(failed_count), ex=SHORTLIST_BATCH_TTL)
    except Exception as exc:
        logger.warning(
            "run_shortlist: failed to store failed count for job %s: %s", job_id, exc
        )


# ---------------------------------------------------------------------------
# Task 4.7 — Batch shortlisting (Celery)
# ---------------------------------------------------------------------------

@celery_app.task(
    name="tasks.run_shortlist",
    bind=True,
    max_retries=config.celery.default_max_retries,
)
def run_shortlist(
    self,
    job_id: str,
    candidate_ids: Optional[List[str]] = None,
    force: bool = False,
):
    """
    Celery task: run AI shortlisting for ready candidates in a job.

    Enqueued by POST /api/jobs/{job_id}/shortlist.
    Optional candidate_ids limits scoring to a subset (also stored in Redis).
    force=True re-scores candidates that already have ShortlistResult rows.
    """
    try:
        asyncio.run(_async_shortlist(self, job_id, candidate_ids, force=force))
    except Exception as exc:
        logger.error("run_shortlist failed for job %s: %s", job_id, exc)
        raise
    finally:
        try:
            _r = redis_lib.from_url(config.REDIS_URL or "redis://localhost:6379/0")
            _r.delete(_shortlist_lock_key(job_id))
            # Keep batch + failed keys briefly for status polling after completion
        except Exception as lock_exc:
            logger.warning(
                "run_shortlist: failed to release Redis lock for job %s: %s",
                job_id,
                lock_exc,
            )


async def _async_shortlist(
    task_self,
    job_id: str,
    candidate_ids: Optional[List[str]] = None,
    *,
    force: bool = False,
) -> None:
    """Async inner function — runs inside asyncio.run() with a fresh event loop."""
    import openai  # local import — not installed at task discovery time

    from app.services.shortlist_service import shortlist_candidates

    batch_ids = _load_batch_candidate_ids(job_id, candidate_ids)
    if batch_ids:
        log_event(
            logger,
            "Shortlisting worker started for %s%s",
            plural(len(batch_ids), "candidate"),
            " (force re-score)" if force else "",
        )
    else:
        log_event(logger, "Shortlisting worker started for all ready candidates on this job")

    async with get_celery_db() as session:
        try:
            results, failed_count = await shortlist_candidates(
                uuid.UUID(job_id),
                session,
                candidate_ids=batch_ids if batch_ids else None,
                force=force,
            )
            _store_failed_count(job_id, failed_count)
            by_rec: dict[str, int] = {}
            for r in results:
                by_rec[r.recommendation] = by_rec.get(r.recommendation, 0) + 1
            log_event(
                logger,
                "Shortlisting finished — %s shortlisted, %s marked for review, %s rejected%s",
                plural(by_rec.get("shortlisted", 0), "candidate"),
                plural(by_rec.get("review", 0), "candidate"),
                plural(by_rec.get("rejected", 0), "candidate"),
                f", {plural(failed_count, 'failure')}" if failed_count else "",
            )

        except openai.AuthenticationError as exc:
            logger.error(
                "OpenAI API key invalid — cannot shortlist job %s: %s", job_id, exc
            )
            return

        except openai.RateLimitError as exc:
            logger.warning(
                "OpenAI rate limit hit shortlisting job %s — will retry in 300s: %s",
                job_id,
                exc,
            )
            raise task_self.retry(
                exc=exc, countdown=config.celery.rate_limit_countdown_sec
            )

        except openai.APIConnectionError as exc:
            logger.warning(
                "OpenAI connection error shortlisting job %s — will retry in 120s: %s",
                job_id,
                exc,
            )
            raise task_self.retry(
                exc=exc, countdown=config.celery.transient_countdown_sec
            )

        except ValueError as exc:
            logger.error(
                "run_shortlist: job %s not found — aborting (no retry): %s", job_id, exc
            )
            return

        except Exception as exc:
            logger.error(
                "run_shortlist: unexpected error for job %s — will retry: %s", job_id, exc
            )
            raise task_self.retry(
                exc=exc, countdown=config.celery.transient_countdown_sec
            )
