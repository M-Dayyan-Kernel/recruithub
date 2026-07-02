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
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_DELAY_SECONDS = 1800  # 30 minutes
MIN_RETRY_DELAY_SECONDS = 60
MAX_RETRY_DELAY_SECONDS = 7 * 24 * 60 * 60  # 7 days
MIN_MAX_RETRIES = 1
MAX_MAX_RETRIES = 10


@dataclass
class CachedSettings:
    allowed_phone_regions: List[str]
    enforce_phone_geography: bool
    screening_max_retries: int
    screening_retry_delay_seconds: int
    fetched_at: datetime


_cache: CachedSettings | None = None
_cache_lock = asyncio.Lock()
_CACHE_TTL = timedelta(seconds=30)


def _defaults() -> CachedSettings:
    return CachedSettings(
        allowed_phone_regions=list(DEFAULT_REGIONS),
        enforce_phone_geography=True,
        screening_max_retries=DEFAULT_MAX_RETRIES,
        screening_retry_delay_seconds=DEFAULT_RETRY_DELAY_SECONDS,
        fetched_at=datetime.min,
    )


def normalize_max_retries(value: int | None) -> int:
    if value is None:
        return DEFAULT_MAX_RETRIES
    if not isinstance(value, int):
        raise ValueError("screening_max_retries must be an integer")
    if value < MIN_MAX_RETRIES or value > MAX_MAX_RETRIES:
        raise ValueError(
            f"screening_max_retries must be between {MIN_MAX_RETRIES} and {MAX_MAX_RETRIES}"
        )
    return value


def normalize_retry_delay_seconds(value: int | None) -> int:
    if value is None:
        return DEFAULT_RETRY_DELAY_SECONDS
    if not isinstance(value, int):
        raise ValueError("screening_retry_delay_seconds must be an integer")
    if value < MIN_RETRY_DELAY_SECONDS or value > MAX_RETRY_DELAY_SECONDS:
        raise ValueError(
            f"screening_retry_delay_seconds must be between "
            f"{MIN_RETRY_DELAY_SECONDS} and {MAX_RETRY_DELAY_SECONDS}"
        )
    return value


def can_schedule_retry(retry_count: int, max_attempts: int) -> bool:
    """
    Return True if another dial attempt may be scheduled after this one.

    screening_max_retries is the total number of dial attempts allowed (including the first).
    E.g. max_attempts=3 allows retry_count 0, 1, 2 then stops.
    """
    if max_attempts <= 1:
        return False
    return retry_count < max_attempts - 1


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
                screening_max_retries=normalize_max_retries(row.screening_max_retries),
                screening_retry_delay_seconds=normalize_retry_delay_seconds(
                    row.screening_retry_delay_seconds
                ),
                fetched_at=now,
            )
            return _cache


def invalidate_settings_cache() -> None:
    global _cache
    _cache = None
