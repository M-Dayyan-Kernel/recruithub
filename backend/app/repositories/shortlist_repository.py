"""ShortlistResult persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models.models import Job, ShortlistResult


class ShortlistRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_for_tenant(
        self, shortlist_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> ShortlistResult:
        result = await self._session.execute(
            select(ShortlistResult)
            .join(Job, ShortlistResult.job_id == Job.id)
            .where(ShortlistResult.id == shortlist_id, Job.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            raise NotFoundError(public_message="Shortlist result not found")
        return record

    async def list_for_job(self, job_id: uuid.UUID) -> list[ShortlistResult]:
        result = await self._session.execute(
            select(ShortlistResult)
            .where(ShortlistResult.job_id == job_id)
            .order_by(ShortlistResult.match_score.desc())
        )
        return list(result.scalars().all())

    async def count_for_candidates(
        self, job_id: uuid.UUID, candidate_ids: list[uuid.UUID]
    ) -> int:
        if not candidate_ids:
            return 0
        result = await self._session.execute(
            select(ShortlistResult.candidate_id).where(
                ShortlistResult.job_id == job_id,
                ShortlistResult.candidate_id.in_(candidate_ids),
            )
        )
        return len(result.scalars().all())

    async def has_result_for_candidate(self, candidate_id: uuid.UUID) -> bool:
        result = await self._session.execute(
            select(ShortlistResult.id).where(
                ShortlistResult.candidate_id == candidate_id
            )
        )
        return result.scalar_one_or_none() is not None

    async def get_by_id(self, shortlist_id: uuid.UUID) -> ShortlistResult | None:
        return await self._session.get(ShortlistResult, shortlist_id)

    async def flush(self) -> None:
        await self._session.flush()

    async def refresh(self, record: ShortlistResult) -> None:
        await self._session.refresh(record)
