"""
System settings loader — single-row system_settings table (id=1).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.models import SystemSettings

DEFAULT_REGIONS = ["IN"]


@dataclass
class CachedSettings:
    allowed_phone_regions: List[str]
    enforce_phone_geography: bool
    fetched_at: datetime


_cache: CachedSettings | None = None
_cache_lock = asyncio.Lock()
_CACHE_TTL = timedelta(seconds=30)


def _defaults() -> CachedSettings:
    return CachedSettings(
        allowed_phone_regions=list(DEFAULT_REGIONS),
        enforce_phone_geography=True,
        fetched_at=datetime.min,
    )


async def get_system_settings() -> CachedSettings:
    global _cache
    async with _cache_lock:
        now = datetime.utcnow()
        if _cache and (now - _cache.fetched_at) < _CACHE_TTL:
            return _cache

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(SystemSettings).where(SystemSettings.id == 1)
            )
            row = result.scalar_one_or_none()
            if not row:
                _cache = _defaults()
                _cache.fetched_at = now
                return _cache

            _cache = CachedSettings(
                allowed_phone_regions=list(row.allowed_phone_regions or DEFAULT_REGIONS),
                enforce_phone_geography=bool(row.enforce_phone_geography),
                fetched_at=now,
            )
            return _cache


def invalidate_settings_cache() -> None:
    global _cache
    _cache = None
