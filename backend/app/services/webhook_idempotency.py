"""Redis-backed webhook idempotency keys."""

from __future__ import annotations

import logging

from app.core.config_loader import config

logger = logging.getLogger(__name__)

_DEFAULT_TTL_SEC = 86400


def _client():
    import redis

    return redis.from_url(config.REDIS_URL or "redis://localhost:6379/0")


def claim_webhook_event(scope: str, event_id: str, *, ttl_sec: int = _DEFAULT_TTL_SEC) -> bool:
    """
    Return True if this event should be processed (first time seen).
    Return False if duplicate.
    """
    if not event_id:
        return True
    key = f"webhook:idempotent:{scope}:{event_id}"
    try:
        claimed = _client().set(key, "1", nx=True, ex=ttl_sec)
        return bool(claimed)
    except Exception as exc:
        logger.warning("webhook idempotency Redis unavailable (%s) — processing anyway", exc)
        return True
