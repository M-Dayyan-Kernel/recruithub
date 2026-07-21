"""Celery tasks for transactional outbox dispatch."""

import asyncio
import logging

from app.core.celery_app import celery_app
from app.core.database import get_celery_db
from app.services.outbox_service import dispatch_pending_outbox

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.dispatch_outbox_events")
def dispatch_outbox_events():
    try:
        asyncio.run(_async_dispatch())
    except Exception as exc:
        logger.error("dispatch_outbox_events failed: %s", exc)


async def _async_dispatch() -> None:
    async with get_celery_db() as session:
        published = await dispatch_pending_outbox(session)
        if published:
            logger.info("Published %d outbox events", published)
