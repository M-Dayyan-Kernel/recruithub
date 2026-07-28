"""Redis-backed rate limiting and login lockout."""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request, status

from app.core.async_utils import run_sync
from app.core.config_loader import config

logger = logging.getLogger(__name__)

_rate_lock = threading.Lock()
_memory_hits: Dict[str, Deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _redis_client():
    import redis

    return redis.from_url(config.REDIS_URL or "redis://localhost:6379/0")


def _incr_with_expiry(key: str, window_sec: int) -> int:
    client = _redis_client()
    pipe = client.pipeline()
    pipe.incr(key)
    pipe.expire(key, window_sec, nx=True)
    count, _ = pipe.execute()
    return int(count)


def _delete_redis_key(key: str) -> None:
    _redis_client().delete(key)


def _get_redis_key(key: str) -> bytes | None:
    return _redis_client().get(key)


async def enforce_rate_limit(
    request: Request,
    *,
    scope: str,
    limit: int,
    window_sec: int = 60,
    detail: str = "Too many requests. Try again shortly.",
) -> None:
    """Limit requests per client IP for a named scope."""
    if limit <= 0:
        return

    ip = _client_ip(request)
    key = f"rl:{scope}:{ip}"

    try:
        count = await run_sync(_incr_with_expiry, key, window_sec)
        if count > limit:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)
        return
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("rate limit Redis unavailable (%s) — in-process fallback", exc)

    now = time.monotonic()
    with _rate_lock:
        hits = _memory_hits[key]
        cutoff = now - window_sec
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)
        hits.append(now)


async def record_login_failure(request: Request, email: str) -> None:
    """Increment failed login counter; raises 429 when lockout threshold reached."""
    max_failures = int(config.AUTH_LOCKOUT_MAX_FAILURES)
    lockout_sec = int(config.AUTH_LOCKOUT_SECONDS)
    if max_failures <= 0:
        return

    ip = _client_ip(request)
    norm_email = (email or "").strip().lower()
    key = f"auth:fail:{ip}:{norm_email}"

    try:
        count = await run_sync(_incr_with_expiry, key, lockout_sec)
        if count > max_failures:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Try again later.",
            )
        return
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("login lockout Redis unavailable (%s) — in-process fallback", exc)

    now = time.monotonic()
    with _rate_lock:
        hits = _memory_hits[key]
        cutoff = now - lockout_sec
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= max_failures:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Try again later.",
            )
        hits.append(now)


async def clear_login_failures(request: Request, email: str) -> None:
    ip = _client_ip(request)
    norm_email = (email or "").strip().lower()
    key = f"auth:fail:{ip}:{norm_email}"
    try:
        await run_sync(_delete_redis_key, key)
    except Exception:
        with _rate_lock:
            _memory_hits.pop(key, None)


async def check_login_lockout(request: Request, email: str) -> None:
    """Reject login when lockout counter is already at threshold."""
    max_failures = int(config.AUTH_LOCKOUT_MAX_FAILURES)
    lockout_sec = int(config.AUTH_LOCKOUT_SECONDS)
    if max_failures <= 0:
        return

    ip = _client_ip(request)
    norm_email = (email or "").strip().lower()
    key = f"auth:fail:{ip}:{norm_email}"

    try:
        raw = await run_sync(_get_redis_key, key)
        if raw and int(raw) > max_failures:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Try again later.",
            )
        return
    except HTTPException:
        raise
    except Exception:
        pass

    now = time.monotonic()
    with _rate_lock:
        hits = _memory_hits.get(key, deque())
        cutoff = now - lockout_sec
        active = [t for t in hits if t >= cutoff]
        if len(active) > max_failures:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts. Try again later.",
            )
