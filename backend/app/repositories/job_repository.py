"""Job persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models.models import Job


class JobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_for_tenant(self, job_id: uuid.UUID, tenant_id: uuid.UUID) -> Job:
        result = await self._session.execute(
            select(Job).where(Job.id == job_id, Job.tenant_id == tenant_id)
        )
        job = result.scalar_one_or_none()
        if job is None:
            raise NotFoundError(public_message="Job not found")
        return job

    async def list_for_tenant(
        self, tenant_id: uuid.UUID, *, status: str | None = None
    ) -> list[Job]:
        query = (
            select(Job)
            .where(Job.tenant_id == tenant_id)
            .order_by(Job.created_at.desc())
        )
        if status:
            query = query.where(Job.status == status)
        result = await self._session.execute(query)
        return list(result.scalars().all())

    def add(self, job: Job) -> Job:
        self._session.add(job)
        return job

    async def delete(self, job: Job) -> None:
        await self._session.delete(job)

    async def flush(self) -> None:
        await self._session.flush()

    async def refresh(self, job: Job) -> None:
        await self._session.refresh(job)
