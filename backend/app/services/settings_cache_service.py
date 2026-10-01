"""Per-tenant system settings cache and normalization."""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Dict, List

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_utils import run_sync
from app.core.config_loader import config
from app.core.constants import DEFAULT_PHONE_REGIONS
from app.models.models import SystemSettings
from app.repositories.system_settings_repository import SystemSettingsRepository

_SETTINGS_REDIS_PREFIX = "settings:v1:"


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
_CACHE_TTL = timedelta(seconds=config.screening.cache_ttl_seconds)


def _redis_settings_key(tenant_id: uuid.UUID) -> str:
    return f"{_SETTINGS_REDIS_PREFIX}{tenant_id}"


def _read_redis_settings(tenant_id: uuid.UUID) -> CachedSettings | None:
    try:
        import redis

        raw = redis.from_url(config.REDIS_URL or "redis://localhost:6379/0").get(
            _redis_settings_key(tenant_id)
        )
        if not raw:
            return None
        data = json.loads(raw)
        data["tenant_id"] = uuid.UUID(str(data["tenant_id"]))
        data["fetched_at"] = datetime.fromisoformat(data["fetched_at"])
        return CachedSettings(**data)
    except Exception:
        return None


def _write_redis_settings(cached: CachedSettings) -> None:
    if cached.tenant_id is None:
        return
    try:
        import redis

        payload = asdict(cached)
        payload["tenant_id"] = str(cached.tenant_id)
        payload["fetched_at"] = cached.fetched_at.isoformat()
        redis.from_url(config.REDIS_URL or "redis://localhost:6379/0").setex(
            _redis_settings_key(cached.tenant_id),
            int(_CACHE_TTL.total_seconds()),
            json.dumps(payload),
        )
    except Exception:
        pass


def _defaults(tenant_id: uuid.UUID | None = None) -> CachedSettings:
    return CachedSettings(
        tenant_id=tenant_id,
        allowed_phone_regions=list(DEFAULT_PHONE_REGIONS),
        enforce_phone_geography=True,
        screening_enabled=True,
        screening_max_retries=config.screening.defaults.max_retries,
        screening_retry_delay_seconds=config.screening.defaults.retry_delay_seconds,
        fetched_at=datetime.min,
    )


def normalize_max_retries(value: int | None) -> int:
    bounds = config.screening.validation
    default = config.screening.defaults.max_retries
    if value is None:
        return default
    if not isinstance(value, int):
        raise ValueError("screening_max_retries must be an integer")
    if value < bounds.min_retries or value > bounds.max_retries:
        raise ValueError(
            f"screening_max_retries must be between {bounds.min_retries} and {bounds.max_retries}"
        )
    return value


def normalize_retry_delay_seconds(value: int | None) -> int:
    bounds = config.screening.validation
    default = config.screening.defaults.retry_delay_seconds
    if value is None:
        return default
    if not isinstance(value, int):
        raise ValueError("screening_retry_delay_seconds must be an integer")
    if value < bounds.min_retry_delay_seconds or value > bounds.max_retry_delay_seconds:
        raise ValueError(
            f"screening_retry_delay_seconds must be between "
            f"{bounds.min_retry_delay_seconds} and {bounds.max_retry_delay_seconds}"
        )
    return value


def can_schedule_retry(retry_count: int, max_attempts: int) -> bool:
    if max_attempts <= 1:
        return False
    return retry_count < max_attempts - 1


def settings_from_row(
    row: SystemSettings | None, fetched_at: datetime, tenant_id: uuid.UUID | None
) -> CachedSettings:
    if not row:
        cached = _defaults(tenant_id)
        cached.fetched_at = fetched_at
        return cached
    return CachedSettings(
        tenant_id=row.tenant_id,
        allowed_phone_regions=list(row.allowed_phone_regions or DEFAULT_PHONE_REGIONS),
        enforce_phone_geography=bool(row.enforce_phone_geography),
        screening_enabled=bool(getattr(row, "screening_enabled", True)),
        screening_max_retries=normalize_max_retries(row.screening_max_retries),
        screening_retry_delay_seconds=normalize_retry_delay_seconds(
            row.screening_retry_delay_seconds
        ),
        fetched_at=fetched_at,
    )


class SettingsCacheService:
    def __init__(
        self,
        session: AsyncSession | None = None,
        *,
        settings_repo: SystemSettingsRepository | None = None,
    ) -> None:
        self._session = session
        self._settings_repo = settings_repo

    async def load(
        self,
        tenant_id: uuid.UUID | None = None,
    ) -> CachedSettings:
        if tenant_id is None:
            return _defaults(None)

        global _cache
        now = datetime.utcnow()

        redis_cached = await run_sync(_read_redis_settings, tenant_id)
        if redis_cached and (now - redis_cached.fetched_at) < _CACHE_TTL:
            with _cache_lock:
                _cache[tenant_id] = redis_cached
            return redis_cached

        with _cache_lock:
            cached = _cache.get(tenant_id)
            if cached and (now - cached.fetched_at) < _CACHE_TTL:
                return cached

        if self._session is None:
            raise RuntimeError("SettingsCacheService requires a session to load tenant settings")

        repo = self._settings_repo or SystemSettingsRepository(self._session)
        row = await repo.get_by_tenant_id(tenant_id)
        cached = settings_from_row(row, now, tenant_id)
        with _cache_lock:
            _cache[tenant_id] = cached
        await run_sync(_write_redis_settings, cached)
        return cached

    @staticmethod
    def invalidate(tenant_id: uuid.UUID | None = None) -> None:
        global _cache
        with _cache_lock:
            if tenant_id is None:
                _cache = {}
            else:
                _cache.pop(tenant_id, None)
        try:
            import redis

            client = redis.from_url(config.REDIS_URL or "redis://localhost:6379/0")
            if tenant_id is None:
                for key in client.scan_iter(f"{_SETTINGS_REDIS_PREFIX}*"):
                    client.delete(key)
            else:
                client.delete(_redis_settings_key(tenant_id))
        except Exception:
            pass
