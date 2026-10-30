"""Persistence for extension detection: an organization's blocklist and policy, interview scans.

Every blocklist and policy query takes the organization's `tenant_id`: tenancy is enforced here,
in the query, the way the job repository does it. An id that belongs to another organization is
simply not found.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import ExtensionBlocklistEntry, ExtensionOrgPolicy, InterviewIntegrityScan


class IntegrityRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── organization policy ───────────────────────────────────────────────
    async def get_org_policy(
        self, tenant_id: uuid.UUID, *, for_update: bool = False
    ) -> ExtensionOrgPolicy | None:
        stmt = select(ExtensionOrgPolicy).where(ExtensionOrgPolicy.tenant_id == tenant_id)
        if for_update:
            # populate_existing: a row another request just changed must not be read stale.
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        return (await self._session.execute(stmt)).scalars().first()

    async def ensure_org_policy_row(self, tenant_id: uuid.UUID) -> None:
        """Create the organization's policy row if it has none. Safe under concurrent calls."""
        stmt = (
            pg_insert(ExtensionOrgPolicy)
            .values(tenant_id=tenant_id)
            .on_conflict_do_nothing(index_elements=["tenant_id"])
        )
        await self._session.execute(stmt)

    # ── blocklist ─────────────────────────────────────────────────────────
    async def list_blocklist(
        self, tenant_id: uuid.UUID, *, active_only: bool = False
    ) -> list[ExtensionBlocklistEntry]:
        stmt = (
            select(ExtensionBlocklistEntry)
            .where(ExtensionBlocklistEntry.tenant_id == tenant_id)
            .order_by(ExtensionBlocklistEntry.name.asc(), ExtensionBlocklistEntry.extension_id.asc())
        )
        if active_only:
            stmt = stmt.where(ExtensionBlocklistEntry.status == "active")
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def count_blocklist(self, tenant_id: uuid.UUID) -> tuple[int, int]:
        """(active, total) for one organization."""
        result = await self._session.execute(
            select(
                func.count().filter(ExtensionBlocklistEntry.status == "active"),
                func.count(),
            )
            .select_from(ExtensionBlocklistEntry)
            .where(ExtensionBlocklistEntry.tenant_id == tenant_id)
        )
        active, total = result.one()
        return int(active or 0), int(total or 0)

    async def get_entry(
        self, tenant_id: uuid.UUID, entry_id: uuid.UUID
    ) -> ExtensionBlocklistEntry | None:
        result = await self._session.execute(
            select(ExtensionBlocklistEntry).where(
                ExtensionBlocklistEntry.tenant_id == tenant_id,
                ExtensionBlocklistEntry.id == entry_id,
            )
        )
        return result.scalars().first()

    async def get_entry_by_extension_id(
        self, tenant_id: uuid.UUID, extension_id: str
    ) -> ExtensionBlocklistEntry | None:
        result = await self._session.execute(
            select(ExtensionBlocklistEntry).where(
                ExtensionBlocklistEntry.tenant_id == tenant_id,
                ExtensionBlocklistEntry.extension_id == extension_id,
            )
        )
        return result.scalars().first()

    def add_entry(self, entry: ExtensionBlocklistEntry) -> ExtensionBlocklistEntry:
        self._session.add(entry)
        return entry

    async def delete_entry(self, entry: ExtensionBlocklistEntry) -> None:
        await self._session.delete(entry)

    # ── scans ─────────────────────────────────────────────────────────────
    def add_scan(self, scan: InterviewIntegrityScan) -> InterviewIntegrityScan:
        self._session.add(scan)
        return scan

    async def list_scans(
        self, interview_session_id: uuid.UUID, *, limit: int = 100
    ) -> list[InterviewIntegrityScan]:
        result = await self._session.execute(
            select(InterviewIntegrityScan)
            .where(InterviewIntegrityScan.interview_session_id == interview_session_id)
            .order_by(InterviewIntegrityScan.created_at.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def flush(self) -> None:
        await self._session.flush()
