"""Tenant invite persistence."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import TenantInvite


class TenantInviteRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, invite_id: uuid.UUID) -> TenantInvite | None:
        return await self._session.get(TenantInvite, invite_id)

    async def get_by_token(self, token: str) -> TenantInvite | None:
        result = await self._session.execute(
            select(TenantInvite).where(TenantInvite.token == token)
        )
        return result.scalars().first()

    async def get_valid_by_token(self, token: str) -> TenantInvite | None:
        invite = await self.get_by_token(token)
        if invite is None or invite.accepted_at is not None:
            return None
        expires = invite.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return None
        return invite

    async def list_unaccepted_for_tenant(self, tenant_id: uuid.UUID) -> list[TenantInvite]:
        result = await self._session.execute(
            select(TenantInvite)
            .where(
                TenantInvite.tenant_id == tenant_id,
                TenantInvite.accepted_at.is_(None),
            )
            .order_by(TenantInvite.created_at.desc())
        )
        return list(result.scalars().all())

    async def has_active_pending(
        self, tenant_id: uuid.UUID, email: str, *, now: datetime
    ) -> bool:
        result = await self._session.execute(
            select(TenantInvite.id)
            .where(
                TenantInvite.tenant_id == tenant_id,
                TenantInvite.email == email.strip().lower(),
                TenantInvite.accepted_at.is_(None),
                TenantInvite.expires_at > now,
            )
            .limit(1)
        )
        return result.scalar_one_or_none() is not None

    def add(self, invite: TenantInvite) -> TenantInvite:
        self._session.add(invite)
        return invite

    async def delete(self, invite: TenantInvite) -> None:
        await self._session.delete(invite)

    async def flush(self) -> None:
        await self._session.flush()
