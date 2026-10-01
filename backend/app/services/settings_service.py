"""
Per-tenant system settings loader with short-lived process cache.

Backward-compatible shim over settings_cache_service.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.services.settings_cache_service import (
    CachedSettings,
    SettingsCacheService,
    _defaults,
    can_schedule_retry,
    normalize_max_retries,
    normalize_retry_delay_seconds,
    settings_from_row,
)

_settings_from_row = settings_from_row

__all__ = [
    "CachedSettings",
    "can_schedule_retry",
    "invalidate_settings_cache",
    "load_system_settings",
    "get_system_settings",
    "normalize_max_retries",
    "normalize_retry_delay_seconds",
    "_defaults",
    "_settings_from_row",
]


async def load_system_settings(
    session: AsyncSession | None = None,
    *,
    tenant_id: uuid.UUID | None = None,
) -> CachedSettings:
    if session is not None:
        return await SettingsCacheService(session).load(tenant_id)

    if tenant_id is None:
        return await SettingsCacheService(None).load(None)

    async with AsyncSessionLocal() as owned:
        return await SettingsCacheService(owned).load(tenant_id)


async def get_system_settings(tenant_id: uuid.UUID) -> CachedSettings:
    return await load_system_settings(None, tenant_id=tenant_id)


def invalidate_settings_cache(tenant_id: uuid.UUID | None = None) -> None:
    SettingsCacheService.invalidate(tenant_id)
