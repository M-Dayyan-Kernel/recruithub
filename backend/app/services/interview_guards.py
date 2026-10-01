"""Join-window, rate-limit, and LiveKit webhook guards for public interview routes."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict

from fastapi import HTTPException, Request

from app.core.async_utils import run_sync
from app.core.config_loader import config
from app.core.settings import settings

logger = logging.getLogger(__name__)

_rate_lock = threading.Lock()
_memory_hits: Dict[str, Deque[float]] = defaultdict(deque)


async def assert_session_joinable(session, db) -> None:
    """
    Enforce link expiry and scheduled start window for public start/complete.

    Mutates session.status to expired when the link is past expires_at.
    """
    now = datetime.now(timezone.utc)

    if session.expires_at and session.expires_at < now:
        if session.status not in ("completed", "expired", "assessed", "assessment_failed"):
            session.status = "expired"
            await db.commit()
            await db.refresh(session)
        raise HTTPException(status_code=410, detail="Interview link has expired.")

    scheduled = getattr(session, "scheduled_interview_at", None)
    if scheduled is not None:
        grace = timedelta(seconds=int(config.interview.schedule_early_grace_sec))
        opens_at = scheduled - grace
        if now < opens_at:
            # Present the scheduled time (not grace-adjusted) to the candidate.
            when = scheduled.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            raise HTTPException(
                status_code=403,
                detail=f"Interview opens at {when}. Please join at the scheduled time.",
            )


def _enforce_public_interview_rate_limit_sync(token: str, action: str) -> None:
    """Limit public interview start/complete to N requests per token per minute."""
    limit = int(config.interview.public_rate_limit_per_minute)
    if limit <= 0:
        return

    key = f"interview:rl:{action}:{token}"
    window_sec = 60

    try:
        import redis as redis_lib

        client = redis_lib.from_url(config.REDIS_URL or "redis://localhost:6379/0")
        count = client.incr(key)
        if count == 1:
            client.expire(key, window_sec)
        if count > limit:
            raise HTTPException(
                status_code=429,
                detail="Too many requests for this interview link. Try again shortly.",
            )
        return
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "interview rate limit: Redis unavailable (%s) — using in-process fallback",
            exc,
        )

    now = time.monotonic()
    with _rate_lock:
        hits = _memory_hits[key]
        cutoff = now - window_sec
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= limit:
            raise HTTPException(
                status_code=429,
                detail="Too many requests for this interview link. Try again shortly.",
            )
        hits.append(now)


async def enforce_public_interview_rate_limit(token: str, action: str) -> None:
    await run_sync(_enforce_public_interview_rate_limit_sync, token, action)


async def verify_livekit_webhook_body(request: Request) -> Dict[str, Any]:
    """
    Verify LiveKit webhook Authorization signature when secrets are configured.

    - MOCK_LIVEKIT / MOCK_EXTERNAL_APIS: skip verify
    - Empty LIVEKIT_API_KEY/SECRET: warn and allow (non-production)
    - Otherwise: reject with 401 on invalid signature
    """
    raw = await request.body()
    try:
        body_str = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook body encoding") from exc

    from app.clients.mocks import mock_livekit_enabled

    if mock_livekit_enabled():
        try:
            return json.loads(body_str) if body_str else {}
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    api_key = (settings.LIVEKIT_API_KEY or "").strip()
    api_secret = (settings.LIVEKIT_API_SECRET or "").strip()
    if not api_key or not api_secret:
        logger.warning(
            "LIVEKIT_API_KEY/SECRET empty — accepting unauthenticated LiveKit webhooks "
            "(not for production)"
        )
        try:
            return json.loads(body_str) if body_str else {}
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    auth = request.headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        auth = auth[7:].strip()
    if not auth:
        raise HTTPException(status_code=401, detail="Missing LiveKit webhook Authorization")

    try:
        from livekit.api import TokenVerifier, WebhookReceiver

        receiver = WebhookReceiver(TokenVerifier(api_key, api_secret))
        receiver.receive(body_str, auth)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("LiveKit webhook signature verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid LiveKit webhook signature") from exc

    try:
        return json.loads(body_str) if body_str else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
