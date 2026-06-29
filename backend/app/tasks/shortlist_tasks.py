"""
Shortlist Tasks — Sprint 4

Celery task for batch AI shortlisting of candidates.
Follows exact same pattern as resume_tasks.py:
  - Sync Celery task wrapper → asyncio.run() → async inner function
  - get_celery_db() for NullPool DB sessions (critical on Windows event loop)
  - Explicit openai error handling with appropriate retry / no-retry decisions
"""

import asyncio
import logging
import uuid

import redis as redis_lib

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.database import get_celery_db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Task 4.7 — Batch shortlisting (Celery)
# ---------------------------------------------------------------------------

@celery_app.task(name="tasks.run_shortlist", bind=True, max_retries=3)
def run_shortlist(self, job_id: str):
    """
    Celery task: run AI shortlisting for all ready candidates in a job.

    Enqueued by POST /api/jobs/{job_id}/shortlist.
    Uses asyncio.run() + get_celery_db() (NullPool) — same pattern as parse_resume.
    Releases the Redis shortlist_lock on completion or failure (B-7).

    Retry behaviour:
      - AuthenticationError → no retry (bad API key won't fix itself)
      - RateLimitError → retry after 300s (5 min)
      - APIConnectionError → retry after 120s (2 min)
      - Job not found (ValueError) → no retry (job won't appear by itself)
      - Other exceptions → retry after 120s
    """
    try:
        asyncio.run(_async_shortlist(self, job_id))
    except Exception as exc:
        logger.error("run_shortlist failed for job %s: %s", job_id, exc)
        raise
    finally:
        # B-7: Release the Redis lock so HR can trigger again after task completes
        try:
            _r = redis_lib.from_url(settings.REDIS_URL or "redis://localhost:6379/0")
            _r.delete(f"shortlist_lock:{job_id}")
        except Exception as lock_exc:
            logger.warning(
                "run_shortlist: failed to release Redis lock for job %s: %s",
                job_id,
                lock_exc,
            )


async def _async_shortlist(task_self, job_id: str) -> None:
    """Async inner function — runs inside asyncio.run() with a fresh event loop."""
    import openai  # local import — not installed at task discovery time

    from app.services.shortlist_service import shortlist_candidates

    async with get_celery_db() as session:
        try:
            results = await shortlist_candidates(uuid.UUID(job_id), session)
            logger.info(
                "run_shortlist: completed for job %s — %d candidates scored",
                job_id,
                len(results),
            )

        except openai.AuthenticationError as exc:
            # Bad API key — no point retrying; HR will see candidates remain unshortlisted
            logger.error(
                "OpenAI API key invalid — cannot shortlist job %s: %s", job_id, exc
            )
            return  # Do NOT retry

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
            # Job not found — raised by shortlist_service when job_id doesn't exist
            logger.error(
                "run_shortlist: job %s not found — aborting (no retry): %s", job_id, exc
            )
            return  # Do NOT retry — job won't appear by itself

        except Exception as exc:
            logger.error(
                "run_shortlist: unexpected error for job %s — will retry: %s", job_id, exc
            )
            raise task_self.retry(exc=exc, countdown=120)
