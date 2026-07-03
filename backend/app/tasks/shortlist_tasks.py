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
from app.core.config import settings
from app.core.database import get_celery_db

logger = logging.getLogger(__name__)


def _shortlist_lock_key(job_id: str) -> str:
    return f"shortlist_lock:{job_id}"


def _shortlist_batch_key(job_id: str) -> str:
    return f"shortlist_batch:{job_id}"


def _load_batch_candidate_ids(job_id: str, candidate_ids: Optional[List[str]]) -> List[uuid.UUID]:
    """Resolve candidate IDs from task args or Redis batch key."""
    if candidate_ids:
        return [uuid.UUID(cid) for cid in candidate_ids]
    try:
        _r = redis_lib.from_url(settings.REDIS_URL or "redis://localhost:6379/0")
        batch_raw = _r.get(_shortlist_batch_key(job_id))
        if batch_raw:
            return [uuid.UUID(cid) for cid in json.loads(batch_raw)]
    except Exception as exc:
        logger.warning("run_shortlist: failed to read batch from Redis for job %s: %s", job_id, exc)
    return []


# ---------------------------------------------------------------------------
# Task 4.7 — Batch shortlisting (Celery)
# ---------------------------------------------------------------------------

@celery_app.task(name="tasks.run_shortlist", bind=True, max_retries=3)
def run_shortlist(self, job_id: str, candidate_ids: Optional[List[str]] = None):
    """
    Celery task: run AI shortlisting for ready candidates in a job.

    Enqueued by POST /api/jobs/{job_id}/shortlist.
    Optional candidate_ids limits scoring to a subset (also stored in Redis).
    """
    try:
        asyncio.run(_async_shortlist(self, job_id, candidate_ids))
    except Exception as exc:
        logger.error("run_shortlist failed for job %s: %s", job_id, exc)
        raise
    finally:
        try:
            _r = redis_lib.from_url(settings.REDIS_URL or "redis://localhost:6379/0")
            _r.delete(_shortlist_lock_key(job_id))
            _r.delete(_shortlist_batch_key(job_id))
        except Exception as lock_exc:
            logger.warning(
                "run_shortlist: failed to release Redis keys for job %s: %s",
                job_id,
                lock_exc,
            )


async def _async_shortlist(
    task_self,
    job_id: str,
    candidate_ids: Optional[List[str]] = None,
) -> None:
    """Async inner function — runs inside asyncio.run() with a fresh event loop."""
    import openai  # local import — not installed at task discovery time

    from app.services.shortlist_service import shortlist_candidates

    batch_ids = _load_batch_candidate_ids(job_id, candidate_ids)

    async with get_celery_db() as session:
        try:
            results = await shortlist_candidates(
                uuid.UUID(job_id),
                session,
                candidate_ids=batch_ids if batch_ids else None,
            )
            logger.info(
                "run_shortlist: completed for job %s — %d candidates scored",
                job_id,
                len(results),
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
            raise task_self.retry(exc=exc, countdown=300)

        except openai.APIConnectionError as exc:
            logger.warning(
                "OpenAI connection error shortlisting job %s — will retry in 120s: %s",
                job_id,
                exc,
            )
            raise task_self.retry(exc=exc, countdown=120)

        except ValueError as exc:
            logger.error(
                "run_shortlist: job %s not found — aborting (no retry): %s", job_id, exc
            )
            return

        except Exception as exc:
            logger.error(
                "run_shortlist: unexpected error for job %s — will retry: %s", job_id, exc
            )
            raise task_self.retry(exc=exc, countdown=120)
