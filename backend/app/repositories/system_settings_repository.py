"""System settings persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import (
    DEFAULT_COMPANY_NAME,
    DEFAULT_PHONE_REGIONS,
    DEFAULT_SCREENING_MAX_RETRIES,
    DEFAULT_SCREENING_RETRY_DELAY_SECONDS,
    PLATFORM_COMPANY_NAME,
)
from app.models.models import SystemSettings


def default_system_settings_row(
    tenant_id: uuid.UUID,
    *,
    company_name: str | None = None,
    screening_enabled: bool = True,
) -> SystemSettings:
    return SystemSettings(
        tenant_id=tenant_id,
        allowed_phone_regions=list(DEFAULT_PHONE_REGIONS),
        enforce_phone_geography=True,
        screening_enabled=screening_enabled,
        screening_max_retries=DEFAULT_SCREENING_MAX_RETRIES,
        screening_retry_delay_seconds=DEFAULT_SCREENING_RETRY_DELAY_SECONDS,
        company_name=company_name or DEFAULT_COMPANY_NAME,
        integrations={},
    )


class SystemSettingsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_tenant_id(self, tenant_id: uuid.UUID) -> SystemSettings | None:
        result = await self._session.execute(
            select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
        )
        return result.scalar_one_or_none()

    async def get_or_create(
        self,
        tenant_id: uuid.UUID,
        *,
        company_name: str | None = None,
        screening_enabled: bool = True,
        commit: bool = False,
    ) -> SystemSettings:
        row = await self.get_by_tenant_id(tenant_id)
        if row:
            return row
        row = default_system_settings_row(
            tenant_id,
            company_name=company_name,
            screening_enabled=screening_enabled,
        )
        self._session.add(row)
        if commit:
            await self._session.commit()
            await self._session.refresh(row)
        else:
            await self._session.flush()
        return row

    async def get_or_create_platform_settings(self, tenant_id: uuid.UUID) -> SystemSettings:
        return await self.get_or_create(
            tenant_id,
            company_name=PLATFORM_COMPANY_NAME,
            screening_enabled=False,
        )

    async def refresh(self, row: SystemSettings) -> None:
        await self._session.refresh(row)
