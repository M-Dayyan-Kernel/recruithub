"""Lightweight checks that Celery workers are reachable before enqueueing tasks."""

from __future__ import annotations

import logging
import time
from typing import Any

from app.core.async_utils import run_sync
from app.core.celery_queues import CELERY_QUEUE_NAMES, RESUME_QUEUE, SCREENING_QUEUE

logger = logging.getLogger(__name__)

CELERY_UNAVAILABLE_MSG = (
    "Background workers are not running. Start Celery worker and beat processes "
    "(run .\\start-dev.ps1 on Windows or see backend/DEPLOY-CELERY.md)."
)

CELERY_RESUME_UNAVAILABLE_MSG = (
    "No Celery worker is listening on the resume queue. "
    "Resume processing and shortlist re-score require a resume worker "
    "(see backend/DEPLOY-CELERY.md)."
)

CELERY_SCREENING_UNAVAILABLE_MSG = (
    "No Celery worker is listening on the screening queue. "
    "Start a worker with queue 'screening' (see backend/DEPLOY-CELERY.md)."
)

_AVAILABILITY_CACHE_TTL_SEC = 5.0
_availability_cache: dict[str, tuple[float, bool]] = {}


def _inspect(timeout: float = 2.0):
    from app.core.celery_app import celery_app

    return celery_app.control.inspect(timeout=timeout)


def _celery_workers_available_sync(timeout: float = 2.0) -> bool:
    """Return True if at least one Celery worker responds to inspect ping."""
    try:
        ping = _inspect(timeout).ping()
        return bool(ping)
    except Exception as exc:
        logger.warning("Celery health check failed: %s", exc)
        return False


def _active_queue_names_sync(timeout: float = 2.0) -> set[str]:
    """Queue names with at least one subscribed worker."""
    try:
        active_queues = _inspect(timeout).active_queues() or {}
    except Exception as exc:
        logger.warning("Celery active_queues check failed: %s", exc)
        return set()

    names: set[str] = set()
    for worker_queues in active_queues.values():
        for entry in worker_queues or []:
            name = entry.get("name")
            if name:
                names.add(name)
    return names


def celery_workers_available(timeout: float = 2.0) -> bool:
    return _celery_workers_available_sync(timeout)


async def celery_workers_available_async(timeout: float = 2.0) -> bool:
    cache_key = "workers"
    cached = _get_availability_cache(cache_key)
    if cached is not None:
        return cached
    result = await run_sync(_celery_workers_available_sync, timeout)
    _set_availability_cache(cache_key, result)
    return result


def _celery_queue_available_sync(queue: str, timeout: float = 2.0) -> bool:
    if not _celery_workers_available_sync(timeout=timeout):
        return False
    return queue in _active_queue_names_sync(timeout=timeout)


def celery_queue_available(queue: str, timeout: float = 2.0) -> bool:
    return _celery_queue_available_sync(queue, timeout)


async def celery_queue_available_async(queue: str, timeout: float = 2.0) -> bool:
    cache_key = f"queue:{queue}"
    cached = _get_availability_cache(cache_key)
    if cached is not None:
        return cached
    result = await run_sync(_celery_queue_available_sync, queue, timeout)
    _set_availability_cache(cache_key, result)
    return result


def _get_availability_cache(key: str) -> bool | None:
    entry = _availability_cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() >= expires_at:
        _availability_cache.pop(key, None)
        return None
    return value


def _set_availability_cache(key: str, value: bool) -> None:
    _availability_cache[key] = (time.monotonic() + _AVAILABILITY_CACHE_TTL_SEC, value)


def celery_queue_unavailable_message(queue: str) -> str:
    if queue == RESUME_QUEUE:
        return CELERY_RESUME_UNAVAILABLE_MSG
    if queue == SCREENING_QUEUE:
        return CELERY_SCREENING_UNAVAILABLE_MSG
    return (
        f"No Celery worker is listening on the {queue} queue. "
        "See backend/DEPLOY-CELERY.md."
    )


def get_queue_lengths() -> dict[str, int | None]:
    """Best-effort Redis list lengths for each named queue."""
    try:
        import redis

        from app.core.config_loader import config

        client = redis.from_url(config.REDIS_URL)
        return {name: int(client.llen(name)) for name in CELERY_QUEUE_NAMES}
    except Exception as exc:
        logger.warning("Celery queue length check failed: %s", exc)
        return {name: None for name in CELERY_QUEUE_NAMES}


def get_celery_health_snapshot(timeout: float = 2.0) -> dict[str, Any]:
    """Structured Celery health for ops endpoints."""
    workers: dict[str, bool] = {}
    active_queues: dict[str, list[str]] = {}
    subscribed: set[str] = set()
    try:
        inspect = _inspect(timeout)
        ping = inspect.ping() or {}
        workers = {name: True for name in ping}
        raw_active = inspect.active_queues() or {}
        for worker_name, queues in raw_active.items():
            names = [
                entry.get("name", "")
                for entry in (queues or [])
                if entry.get("name")
            ]
            active_queues[worker_name] = names
            subscribed.update(names)
    except Exception as exc:
        logger.warning("Celery health snapshot failed: %s", exc)

    queue_lengths = get_queue_lengths()

    return {
        "workers_online": len(workers),
        "workers": workers,
        "subscribed_queues": sorted(subscribed),
        "active_queues_by_worker": active_queues,
        "queue_lengths": queue_lengths,
        "queues_ready": {name: name in subscribed for name in CELERY_QUEUE_NAMES},
    }


async def get_celery_health_snapshot_async(timeout: float = 2.0) -> dict[str, Any]:
    return await run_sync(get_celery_health_snapshot, timeout)
