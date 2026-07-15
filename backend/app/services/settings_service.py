"""
Per-tenant system settings loader with short-lived process cache.
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
    tenant_id: uuid.UUID | None
    allowed_phone_regions: List[str]
    enforce_phone_geography: bool
    screening_enabled: bool
    screening_max_retries: int
    screening_retry_delay_seconds: int
    fetched_at: datetime


_cache: Dict[uuid.UUID, CachedSettings] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = timedelta(seconds=30)


def _defaults(tenant_id: uuid.UUID | None = None) -> CachedSettings:
    return CachedSettings(
        tenant_id=tenant_id,
        allowed_phone_regions=list(DEFAULT_REGIONS),
        enforce_phone_geography=True,
        screening_enabled=True,
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


def _settings_from_row(
    row: SystemSettings | None, fetched_at: datetime, tenant_id: uuid.UUID | None
) -> CachedSettings:
    if not row:
        cached = _defaults(tenant_id)
        cached.fetched_at = fetched_at
        return cached
    return CachedSettings(
        tenant_id=row.tenant_id,
        allowed_phone_regions=list(row.allowed_phone_regions or DEFAULT_REGIONS),
        enforce_phone_geography=bool(row.enforce_phone_geography),
        screening_enabled=bool(getattr(row, "screening_enabled", True)),
        screening_max_retries=normalize_max_retries(row.screening_max_retries),
        screening_retry_delay_seconds=normalize_retry_delay_seconds(
            row.screening_retry_delay_seconds
        ),
        fetched_at=fetched_at,
    )


async def load_system_settings(
    session: AsyncSession | None = None,
    *,
    tenant_id: uuid.UUID | None = None,
) -> CachedSettings:
    """
    Load system settings for a tenant.

    Pass the Celery task session when inside asyncio.run() to avoid reusing the
    FastAPI connection pool across closed event loops (Windows Celery beat).
    """
    if tenant_id is None:
        return _defaults(None)

    global _cache
    now = datetime.utcnow()
    with _cache_lock:
        cached = _cache.get(tenant_id)
        if cached and (now - cached.fetched_at) < _CACHE_TTL:
            return cached

    if session is not None:
        result = await session.execute(
            select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
        )
        row = result.scalar_one_or_none()
    else:
        async with AsyncSessionLocal() as owned:
            result = await owned.execute(
                select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
            )
            row = result.scalar_one_or_none()

    cached = _settings_from_row(row, now, tenant_id)
    with _cache_lock:
        _cache[tenant_id] = cached
    return cached


async def get_system_settings(tenant_id: uuid.UUID) -> CachedSettings:
    return await load_system_settings(None, tenant_id=tenant_id)


def invalidate_settings_cache(tenant_id: uuid.UUID | None = None) -> None:
    global _cache
    with _cache_lock:
        if tenant_id is None:
            _cache = {}
        else:
            _cache.pop(tenant_id, None)
