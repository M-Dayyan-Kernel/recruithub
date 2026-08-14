"""Connection reconciler — POC side.

Celery beat sweeps transient one-click-connect flows and advances each one
(ping_b to talentOS, backoff, budget fail). Mirrors talentOS's link_reconciler.

Pattern: sync Celery wrapper → asyncio.run() → async inner function.
DB sessions: get_celery_db() (NullPool) — mandatory for Celery on Windows event loop.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.config_loader import config
from app.core.database import get_celery_db
from app.modules.talentos_integration.connect_models import (
    TRANSIENT_STATES,
    IntegrationLinkFlow,
)
from app.modules.talentos_integration.connect_service import MAX_ATTEMPTS

logger = logging.getLogger(__name__)

BATCH_SIZE = 50


def _now() -> datetime:
    return datetime.now(timezone.utc)


@celery_app.task(name="tasks.reconcile_pending_connections", bind=True, max_retries=0)
def reconcile_pending_connections(self):
    """Beat task: advance all due transient connect flows (one sweep)."""
    try:
        asyncio.run(_sweep_once())
    except Exception as exc:
        logger.error("reconcile_pending_connections failed: %s", exc)


async def _sweep_once() -> int:
    from app.modules.talentos_integration.connect_service import ConnectService

    processed = 0
    async with get_celery_db() as session:
        result = await session.execute(
            select(IntegrationLinkFlow)
            .where(
                IntegrationLinkFlow.state.in_(TRANSIENT_STATES),
                IntegrationLinkFlow.next_retry_at <= _now(),
                IntegrationLinkFlow.attempts < MAX_ATTEMPTS,
            )
            .order_by(IntegrationLinkFlow.next_retry_at.asc())
            .limit(BATCH_SIZE)
            .with_for_update(skip_locked=True)
        )
        flows = list(result.scalars().all())
        service = ConnectService(session)
        for flow in flows:
            try:
                outcome = await service.reconcile_flow(flow)
                await session.commit()
                processed += 1
                logger.info(
                    "Reconciled connect flow %s -> %s (outcome=%s)",
                    flow.flow_id, flow.state, outcome,
                )
            except Exception:
                await session.rollback()
                logger.exception("Reconcile failed for flow %s", flow.flow_id)

        try:
            cleaned = await service.cleanup_expired()
            if cleaned:
                await session.commit()
                logger.info("Cleaned %d expired connect flows", cleaned)
        except Exception:
            await session.rollback()
            logger.exception("cleanup_expired failed")
    return processed
