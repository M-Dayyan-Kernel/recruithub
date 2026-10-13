"""Persistence for extension detection: blocklist, policy, interview scans."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import ExtensionBlocklistEntry, ExtensionPolicy, InterviewIntegrityScan
from app.services.integrity_defaults import POLICY_ID


class IntegrityRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── policy ────────────────────────────────────────────────────────────
    async def get_policy(self) -> ExtensionPolicy | None:
        return await self._session.get(ExtensionPolicy, POLICY_ID)

    def add_policy(self, policy: ExtensionPolicy) -> ExtensionPolicy:
        self._session.add(policy)
        return policy

    # ── blocklist ─────────────────────────────────────────────────────────
    async def list_blocklist(self, *, active_only: bool = False) -> list[ExtensionBlocklistEntry]:
        stmt = select(ExtensionBlocklistEntry).order_by(
            ExtensionBlocklistEntry.name.asc(), ExtensionBlocklistEntry.extension_id.asc()
        )
        if active_only:
            stmt = stmt.where(ExtensionBlocklistEntry.status == "active")
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def count_blocklist(self) -> tuple[int, int]:
        """(active, total)."""
        result = await self._session.execute(
            select(
                func.count().filter(ExtensionBlocklistEntry.status == "active"),
                func.count(),
            ).select_from(ExtensionBlocklistEntry)
        )
        active, total = result.one()
        return int(active or 0), int(total or 0)

    async def get_entry(self, entry_id: uuid.UUID) -> ExtensionBlocklistEntry | None:
        return await self._session.get(ExtensionBlocklistEntry, entry_id)

    async def get_entry_by_extension_id(self, extension_id: str) -> ExtensionBlocklistEntry | None:
        result = await self._session.execute(
            select(ExtensionBlocklistEntry).where(
                ExtensionBlocklistEntry.extension_id == extension_id
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
