"""ScreeningCall persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models.models import Job, ScreeningCall

LIVE_CALL_STATUSES = ("initiated", "in_progress")


class ScreeningRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_for_tenant(
        self, screening_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> ScreeningCall:
        result = await self._session.execute(
            select(ScreeningCall)
            .join(Job, ScreeningCall.job_id == Job.id)
            .where(ScreeningCall.id == screening_id, Job.tenant_id == tenant_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            raise NotFoundError(public_message="Screening call not found")
        return record

    async def get_by_vapi_call_id(self, vapi_call_id: str) -> ScreeningCall | None:
        result = await self._session.execute(
            select(ScreeningCall).where(ScreeningCall.vapi_call_id == vapi_call_id)
        )
        return result.scalars().first()

    async def list_for_job(self, job_id: uuid.UUID) -> list[ScreeningCall]:
        result = await self._session.execute(
            select(ScreeningCall)
            .where(ScreeningCall.job_id == job_id)
            .order_by(ScreeningCall.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_live_for_job(self, job_id: uuid.UUID) -> list[ScreeningCall]:
        result = await self._session.execute(
            select(ScreeningCall).where(
                ScreeningCall.job_id == job_id,
                ScreeningCall.call_status.in_(LIVE_CALL_STATUSES),
            )
        )
        return list(result.scalars().all())

    async def flush(self) -> None:
        await self._session.flush()

    async def refresh(self, call: ScreeningCall) -> None:
        await self._session.refresh(call)
