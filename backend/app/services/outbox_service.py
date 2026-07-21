"""Transactional outbox for emails and Celery side effects."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import OutboxEvent

logger = logging.getLogger(__name__)


async def enqueue_outbox_event(
    session: AsyncSession,
    *,
    event_type: str,
    payload: dict[str, Any],
    tenant_id: uuid.UUID | None = None,
) -> OutboxEvent:
    event = OutboxEvent(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        event_type=event_type,
        payload=payload,
    )
    session.add(event)
    await session.flush()
    return event


async def dispatch_pending_outbox(session: AsyncSession, *, batch_size: int = 50) -> int:
    """Publish unpublished outbox rows (called from Celery beat)."""
    result = await session.execute(
        select(OutboxEvent)
        .where(OutboxEvent.published_at.is_(None))
        .order_by(OutboxEvent.created_at.asc())
        .limit(batch_size)
    )
    events = result.scalars().all()
    if not events:
        return 0

    published = 0
    now = datetime.now(timezone.utc)
    for event in events:
        try:
            _publish_event(event)
            event.published_at = now
            published += 1
        except Exception as exc:
            logger.error("outbox publish failed for %s: %s", event.id, exc)
    await session.commit()
    return published


def _publish_event(event: OutboxEvent) -> None:
    etype = event.event_type
    payload = event.payload or {}

    if etype == "celery.apply_async":
        from app.core.celery_app import celery_app

        celery_app.send_task(
            payload["task"],
            args=payload.get("args"),
            kwargs=payload.get("kwargs"),
            queue=payload.get("queue"),
            countdown=payload.get("countdown", 0),
        )
        return

    if etype == "email.send_html":
        from app.services import gmail_service

        gmail_service.send_html_email(
            payload["to"],
            payload["subject"],
            payload["body_html"],
        )
        return

    raise ValueError(f"Unknown outbox event_type: {etype}")
