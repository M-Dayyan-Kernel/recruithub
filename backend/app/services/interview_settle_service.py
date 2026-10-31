"""Settle interviews stuck in progress.

The room-finished webhook cannot reach localhost and a dropped connection can miss it, so a
session can stay `in_progress` long after the candidate left. Past `interview.stale_after_minutes`
it is settled by what was said: with a transcript it is completed and assessed on that, without
one nothing was taken and the round expires, which makes it reschedulable.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import InterviewSession
from app.services.interview_status import COMPLETED, EXPIRED, IN_PROGRESS, stale_after

logger = logging.getLogger(__name__)


async def settle_stale_interviews(db: AsyncSession) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """Settle every stuck in-progress session. Returns (completed ids, expired ids).

    The caller enqueues the assessment for the completed ones after this commits, so a report is
    never generated for a status that then fails to save.
    """
    now = datetime.now(timezone.utc)
    stuck = (
        await db.execute(
            select(InterviewSession)
            .where(
                InterviewSession.status == IN_PROGRESS,
                InterviewSession.started_at.is_not(None),
                InterviewSession.started_at < now - stale_after(),
            )
            # A session another worker is settling, or the candidate is finishing right now,
            # is skipped this round and seen again on the next.
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
    ).scalars().all()

    completed: list[uuid.UUID] = []
    expired: list[uuid.UUID] = []
    for session in stuck:
        if (session.transcript or "").strip():
            session.status = COMPLETED
            session.completed_at = now
            completed.append(session.id)
        else:
            session.status = EXPIRED
            session.expires_at = now
            expired.append(session.id)
    if stuck:
        await db.commit()
        logger.info(
            "settle_stale_interviews: %d completed for assessment, %d expired without a transcript",
            len(completed),
            len(expired),
        )
    return completed, expired
