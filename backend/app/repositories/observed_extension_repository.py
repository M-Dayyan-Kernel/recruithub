"""Persistence for the observed-extensions catalog: one catalog per organization."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import ExtensionBlocklistEntry, ObservedExtension


class ObservedExtensionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def ensure_rows(self, rows: list[dict[str, Any]]) -> None:
        """Create any missing rows (idempotent, safe under concurrent scans). Each row carries its
        organization's `tenant_id`; the same extension is a separate row in every organization.

        Rows are created with ``times_seen = 0``; the caller then locks and
        updates each one, so a first sighting and a repeat go through one path.
        """
        if not rows:
            return
        stmt = pg_insert(ObservedExtension).values(rows).on_conflict_do_nothing(
            index_elements=["tenant_id", "extension_id"]
        )
        await self._session.execute(stmt)

    async def lock_many(
        self, tenant_id: uuid.UUID, extension_ids: list[str]
    ) -> list[ObservedExtension]:
        """Row-lock the given extensions of one organization in a stable order.

        Ordering by extension_id means two scans touching overlapping sets always
        acquire locks in the same sequence, so they cannot deadlock each other.
        """
        if not extension_ids:
            return []
        result = await self._session.execute(
            select(ObservedExtension)
            .where(
                ObservedExtension.tenant_id == tenant_id,
                ObservedExtension.extension_id.in_(extension_ids),
            )
            .order_by(ObservedExtension.extension_id.asc())
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return list(result.scalars().all())

    async def get(self, tenant_id: uuid.UUID, row_id: uuid.UUID) -> ObservedExtension | None:
        result = await self._session.execute(
            select(ObservedExtension).where(
                ObservedExtension.tenant_id == tenant_id, ObservedExtension.id == row_id
            )
        )
        return result.scalars().first()

    @staticmethod
    def _on_blocklist():
        """True for a catalog row whose extension is already on ITS OWN organization's blocklist
        (whatever its on/off state). Matching on the tenant as well matters: another
        organization's list must never hide this one's seen extensions."""
        return exists().where(
            ExtensionBlocklistEntry.tenant_id == ObservedExtension.tenant_id,
            ExtensionBlocklistEntry.extension_id == ObservedExtension.extension_id,
        )

    async def page(
        self, tenant_id: uuid.UUID, *, status: str, limit: int, offset: int
    ) -> tuple[list[ObservedExtension], int]:
        """One page of an organization's catalog, newest sighting first, excluding anything
        that is already on its blocklist."""
        base = (
            ObservedExtension.tenant_id == tenant_id,
            ObservedExtension.status == status,
            ~self._on_blocklist(),
        )

        total = (
            await self._session.execute(
                select(func.count()).select_from(ObservedExtension).where(*base)
            )
        ).scalar_one()
        rows = (
            await self._session.execute(
                select(ObservedExtension)
                .where(*base)
                .order_by(
                    ObservedExtension.last_seen_at.desc(), ObservedExtension.extension_id.asc()
                )
                .limit(limit)
                .offset(offset)
            )
        ).scalars().all()
        return list(rows), int(total or 0)

    async def count_new(self, tenant_id: uuid.UUID) -> int:
        return int(
            (
                await self._session.execute(
                    select(func.count())
                    .select_from(ObservedExtension)
                    .where(
                        ObservedExtension.tenant_id == tenant_id,
                        ObservedExtension.status == "new",
                        ~self._on_blocklist(),
                    )
                )
            ).scalar_one()
            or 0
        )
