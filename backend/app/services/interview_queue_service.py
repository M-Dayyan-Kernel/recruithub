"""Live interview slotting — limit concurrent AI interviews platform-wide."""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.models.models import InterviewSession

logger = logging.getLogger(__name__)

LIVE_INTERVIEW_STATUS = "in_progress"


async def count_live_interviews(session: AsyncSession) -> int:
    """Count in-flight interview sessions across all tenants."""
    result = await session.execute(
        select(func.count())
        .select_from(InterviewSession)
        .where(InterviewSession.status == LIVE_INTERVIEW_STATUS)
    )
    return int(result.scalar() or 0)


async def has_live_interview_slot(session: AsyncSession) -> bool:
    """True when platform is under max_concurrent_interviews."""
    from app.services.mock_external import mock_livekit_enabled

    if mock_livekit_enabled():
        return True

    max_live = config.interview.max_concurrent_interviews
    live = await count_live_interviews(session)
    return live < max_live


def busy_retry_minutes() -> int:
    return int(config.interview.busy_retry_minutes)
