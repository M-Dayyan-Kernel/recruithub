"""Live screening call slotting — limit concurrent Vapi dials per tenant."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.models.models import Job, ScreeningCall

logger = logging.getLogger(__name__)

LIVE_CALL_STATUSES = ("initiated", "in_progress")


async def count_live_screening_calls(
    session: AsyncSession, tenant_id: uuid.UUID
) -> int:
    """Count in-flight screening calls for a tenant."""
    result = await session.execute(
        select(func.count())
        .select_from(ScreeningCall)
        .join(Job, ScreeningCall.job_id == Job.id)
        .where(
            Job.tenant_id == tenant_id,
            ScreeningCall.call_status.in_(LIVE_CALL_STATUSES),
        )
    )
    return int(result.scalar() or 0)


async def has_live_screening_slot(
    session: AsyncSession, tenant_id: uuid.UUID
) -> bool:
    """True when tenant is under max_live_screening_calls."""
    max_live = config.concurrency.max_live_screening_calls
    live = await count_live_screening_calls(session, tenant_id)
    return live < max_live


def live_slot_defer_seconds() -> int:
    return int(config.screening.live_slot_defer_sec)
