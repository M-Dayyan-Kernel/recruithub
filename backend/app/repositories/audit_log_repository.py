"""Audit log persistence."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AuditLog


class AuditLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def add(self, row: AuditLog) -> AuditLog:
        self._session.add(row)
        return row

    async def flush(self) -> None:
        await self._session.flush()

    async def count_filtered(self, filters: list[Any]) -> int:
        count_q = select(func.count()).select_from(AuditLog).where(*filters)
        return int((await self._session.execute(count_q)).scalar_one())

    async def list_filtered(
        self,
        filters: list[Any],
        *,
        limit: int,
        offset: int,
    ) -> list[AuditLog]:
        list_q = (
            select(AuditLog)
            .where(*filters)
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self._session.execute(list_q)
        return list(result.scalars().all())

    @staticmethod
    def build_filters(
        *,
        tenant_id: uuid.UUID,
        entity_type: str | None = None,
        job_id: uuid.UUID | None = None,
        candidate_id: uuid.UUID | None = None,
        actor_user_id: uuid.UUID | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
        search: str | None = None,
    ) -> list[Any]:
        filters: list[Any] = [AuditLog.tenant_id == tenant_id]
        if entity_type:
            filters.append(AuditLog.entity_type == entity_type)
        if job_id:
            filters.append(AuditLog.job_id == job_id)
        if candidate_id:
            filters.append(AuditLog.candidate_id == candidate_id)
        if actor_user_id:
            filters.append(AuditLog.actor_user_id == actor_user_id)
        if from_ts:
            filters.append(AuditLog.created_at >= from_ts)
        if to_ts:
            filters.append(AuditLog.created_at <= to_ts)
        if search and search.strip():
            term = f"%{search.strip()}%"
            filters.append(
                or_(
                    AuditLog.subject_label.ilike(term),
                    AuditLog.feature.ilike(term),
                    AuditLog.actor_name.ilike(term),
                    AuditLog.action.ilike(term),
                )
            )
        return filters
