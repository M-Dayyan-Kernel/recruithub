"""User persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import User


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: uuid.UUID, *, load_tenant: bool = False) -> User | None:
        if not load_tenant:
            return await self._session.get(User, user_id)
        result = await self._session.execute(
            select(User).options(selectinload(User.tenant)).where(User.id == user_id)
        )
        return result.scalars().first()

    async def get_by_email(self, email: str, *, load_tenant: bool = False) -> User | None:
        stmt = select(User).where(User.email == email.strip().lower())
        if load_tenant:
            stmt = stmt.options(selectinload(User.tenant))
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def exists_by_email(self, email: str) -> bool:
        result = await self._session.execute(
            select(User.id).where(User.email == email.strip().lower()).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def list_for_tenant(
        self,
        tenant_id: uuid.UUID,
        *,
        offset: int = 0,
        limit: int = 50,
        exclude_superadmin: bool = False,
    ) -> tuple[list[User], int]:
        base = select(User).where(User.tenant_id == tenant_id)
        if exclude_superadmin:
            base = base.where(User.role != "superadmin")
        base = base.order_by(User.created_at.asc())
        total = int(
            (await self._session.execute(select(func.count()).select_from(base.subquery()))).scalar()
            or 0
        )
        result = await self._session.execute(base.offset(offset).limit(limit))
        return list(result.scalars().all()), total

    async def list_admins_by_tenant(self) -> list[tuple[uuid.UUID, str, str]]:
        result = await self._session.execute(
            select(User.tenant_id, User.email, User.full_name, User.created_at)
            .where(User.role == "admin")
            .order_by(User.created_at.asc())
        )
        return [(row[0], row[1], row[2]) for row in result.all()]

    async def list_for_tenant_unpaginated(
        self, tenant_id: uuid.UUID, *, exclude_superadmin: bool = True
    ) -> list[User]:
        stmt = select(User).where(User.tenant_id == tenant_id).order_by(User.created_at.asc())
        if exclude_superadmin:
            stmt = stmt.where(User.role != "superadmin")
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def count_by_tenant_excluding_superadmin(self) -> dict[uuid.UUID, int]:
        result = await self._session.execute(
            select(User.tenant_id, func.count())
            .where(User.role != "superadmin")
            .group_by(User.tenant_id)
        )
        return {tid: count for tid, count in result.all()}

    async def has_admin(self) -> bool:
        result = await self._session.execute(
            select(User.id).where(User.role == "admin").limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def has_superadmin(self) -> bool:
        result = await self._session.execute(
            select(User.id).where(User.role == "superadmin").limit(1)
        )
        return result.scalar_one_or_none() is not None

    def add(self, user: User) -> User:
        self._session.add(user)
        return user

    async def delete(self, user: User) -> None:
        await self._session.delete(user)

    async def flush(self) -> None:
        await self._session.flush()

    async def refresh(self, user: User) -> None:
        await self._session.refresh(user)
