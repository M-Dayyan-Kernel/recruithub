"""Lightweight checks that Celery workers are reachable before enqueueing tasks."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

CELERY_UNAVAILABLE_MSG = (
    "Background worker (Celery) is not running. Screening calls cannot be placed. "
    "On Windows, start both the Celery worker and Celery beat processes "
    "(run .\\start-dev.ps1 or see README)."
)


def celery_workers_available(timeout: float = 2.0) -> bool:
    """Return True if at least one Celery worker responds to inspect ping."""
    try:
        from app.core.celery_app import celery_app

        ping = celery_app.control.inspect(timeout=timeout).ping()
        return bool(ping)
    except Exception as exc:
        logger.warning("Celery health check failed: %s", exc)
        return False
