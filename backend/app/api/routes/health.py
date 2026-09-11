"""Operational health endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from app.core.async_utils import run_sync
from app.core.config_loader import config
from app.core.database import engine
from app.services.celery_health import get_celery_health_snapshot_async

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_internal_health_key(
    x_health_key: str | None = Header(default=None, alias="X-Health-Key"),
    health_key: str | None = Query(default=None, alias="key"),
) -> None:
    """Optional shared secret — header (preferred) or ?key= for uptime monitors."""
    expected = (config.INTERNAL_HEALTH_API_KEY or "").strip()
    if not expected:
        return
    provided = (x_health_key or health_key or "").strip()
    if not provided or provided != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@router.get("/health/live", tags=["health"])
async def health_live():
    """Process liveness."""
    return {"status": "ok", "version": "1.0.0"}


@router.get("/health/ready", tags=["health"])
async def health_ready():
    """Readiness: Postgres + Redis (+ optional S3 + secrets source)."""
    checks: dict[str, str] = {}

    try:
        from sqlalchemy import text

        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as exc:
        logger.warning("readiness postgres failed: %s", exc)
        checks["postgres"] = "error"

    try:
        import redis

        await run_sync(redis.from_url(config.REDIS_URL).ping)
        checks["redis"] = "ok"
    except Exception as exc:
        logger.warning("readiness redis failed: %s", exc)
        checks["redis"] = "error"

    from app.services.s3_service import s3_configured

    if s3_configured():
        try:
            from app.services.s3_service import head_bucket_async

            await head_bucket_async()
            checks["s3"] = "ok"
        except Exception as exc:
            logger.warning("readiness s3 failed: %s", exc)
            checks["s3"] = "error"
    else:
        checks["s3"] = "skipped"

    status_value = "ok" if all(v in ("ok", "skipped") for v in checks.values()) else "degraded"
    from fastapi.responses import JSONResponse

    from app.core import openbao as secrets_bao

    # Always HTTP 200 — body carries ok/degraded so uptime probes do not spam 4xx/5xx logs.
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"status": status_value, "checks": checks, "secretsSource": secrets_bao.source},
    )


@router.get("/health/celery", tags=["health"], dependencies=[Depends(_require_internal_health_key)])
async def celery_health():
    """Celery worker reachability, queue subscriptions, and queue depths."""
    snapshot = await get_celery_health_snapshot_async()
    status_value = "ok" if snapshot["workers_online"] > 0 else "degraded"
    return {"status": status_value, **snapshot}
