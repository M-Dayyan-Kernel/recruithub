"""Tenant persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import PLATFORM_TENANT_SLUG
from app.core.tenancy import org_name_key, slugify
from app.models.models import Job, SystemSettings, Tenant, tenant_name_key


class TenantRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, tenant_id: uuid.UUID) -> Tenant | None:
        return await self._session.get(Tenant, tenant_id)

    async def get_by_slug(self, slug: str) -> Tenant | None:
        result = await self._session.execute(
            select(Tenant).where(Tenant.slug == slug).limit(1)
        )
        return result.scalars().first()

    async def list_customer_tenants(self) -> list[Tenant]:
        result = await self._session.execute(
            select(Tenant)
            .where(Tenant.slug != PLATFORM_TENANT_SLUG)
            .order_by(Tenant.created_at.desc())
        )
        return list(result.scalars().all())

    async def job_counts_by_tenant(self) -> dict[uuid.UUID, int]:
        result = await self._session.execute(
            select(Job.tenant_id, func.count()).group_by(Job.tenant_id)
        )
        return {tid: count for tid, count in result.all()}

    async def name_exists(
        self, name: str, *, exclude_id: uuid.UUID | None = None
    ) -> bool:
        """True when another organization already uses this name.

        Case- and whitespace-insensitive. ``exclude_id`` lets an organization
        keep (or re-case) its own name when it is renamed.
        """
        stmt = select(Tenant.id).where(tenant_name_key() == org_name_key(name))
        if exclude_id is not None:
            stmt = stmt.where(Tenant.id != exclude_id)
        result = await self._session.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def ensure_unique_slug(self, name: str) -> str:
        base = slugify(name)
        slug = base
        n = 2
        while True:
            existing = await self._session.execute(
                select(Tenant.id).where(Tenant.slug == slug).limit(1)
            )
            if existing.scalar_one_or_none() is None:
                return slug
            slug = f"{base}-{n}"[:80]
            n += 1

    def add(self, tenant: Tenant) -> Tenant:
        self._session.add(tenant)
        return tenant

    async def delete(self, tenant: Tenant) -> None:
        await self._session.delete(tenant)

    async def delete_settings_for_tenant(self, tenant_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
        )

    async def flush(self) -> None:
        await self._session.flush()

    async def refresh(self, tenant: Tenant) -> None:
        await self._session.refresh(tenant)

    async def get_or_create_default(self) -> Tenant:
        tenant = await self.get_by_slug("default")
        if tenant:
            return tenant
        result = await self._session.execute(
            select(Tenant).order_by(Tenant.created_at.asc()).limit(1)
        )
        tenant = result.scalars().first()
        if tenant:
            return tenant
        tenant = Tenant(name="Default Organization", slug="default")
        self.add(tenant)
        await self.flush()
        return tenant
