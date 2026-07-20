"""Operational health endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.celery_health import get_celery_health_snapshot

router = APIRouter()


@router.get("/health/celery", tags=["health"])
async def celery_health():
    """Celery worker reachability, queue subscriptions, and queue depths."""
    snapshot = get_celery_health_snapshot()
    status = "ok" if snapshot["workers_online"] > 0 else "degraded"
    return {"status": status, **snapshot}
