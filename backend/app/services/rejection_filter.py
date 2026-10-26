"""Who is rejected on a job, for the stages that must not list them."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import ShortlistResult


async def rejected_candidate_ids(db: AsyncSession, job_id: uuid.UUID) -> set[uuid.UUID]:
    """Rejected candidates leave the Interviews and Finalists stages; they live in Rejected."""
    return set(
        (
            await db.execute(
                select(ShortlistResult.candidate_id).where(
                    ShortlistResult.job_id == job_id, ShortlistResult.hr_decision == "rejected"
                )
            )
        )
        .scalars()
        .all()
    )
