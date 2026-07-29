from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models.api_key import ApiKey
from app.modules.api_keys.api_key_schema import CreateApiKeyRequest, UpdateApiKeyRequest

logger = logging.getLogger(__name__)

API_KEY_PREFIX = "rhub_"
KEY_BYTES = 48


def _generate_api_key() -> tuple[str, str, str]:
    raw = secrets.token_urlsafe(KEY_BYTES)
    full_key = f"{API_KEY_PREFIX}{raw}"
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    key_prefix = full_key[:8]
    return full_key, key_hash, key_prefix


class ApiKeyService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    @staticmethod
    async def validate_api_key(raw_key: str, db: AsyncSession) -> Optional[ApiKey]:
        if not raw_key.startswith(API_KEY_PREFIX):
            return None
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        result = await db.execute(
            select(ApiKey).where(
                ApiKey.key_hash == key_hash,
                ApiKey.is_active == True,
            )
        )
        api_key = result.scalars().first()
        if api_key is None:
            return None
        api_key.last_used_at = datetime.now(timezone.utc)
        await db.flush()
        return api_key

    async def create(
        self,
        body: CreateApiKeyRequest,
        *,
        created_by_user_id: Optional[uuid.UUID] = None,
    ) -> tuple[ApiKey, str]:
        full_key, key_hash, key_prefix = _generate_api_key()
        api_key = ApiKey(
            name=body.name,
            description=body.description,
            key_hash=key_hash,
            key_prefix=key_prefix,
            created_by_user_id=created_by_user_id,
        )
        self._db.add(api_key)
        await self._db.flush()
        await self._db.refresh(api_key)
        return api_key, full_key

    async def list(self) -> list[ApiKey]:
        result = await self._db.execute(
            select(ApiKey).order_by(ApiKey.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_id(self, api_key_id: uuid.UUID) -> ApiKey:
        api_key = await self._db.get(ApiKey, api_key_id)
        if api_key is None:
            raise NotFoundError(public_message="App key not found")
        return api_key

    async def update(
        self, api_key_id: uuid.UUID, body: UpdateApiKeyRequest
    ) -> ApiKey:
        api_key = await self.get_by_id(api_key_id)
        if body.name is not None:
            api_key.name = body.name
        if body.description is not None:
            api_key.description = body.description
        await self._db.flush()
        await self._db.refresh(api_key)
        return api_key

    async def revoke(self, api_key_id: uuid.UUID) -> None:
        api_key = await self.get_by_id(api_key_id)
        api_key.is_active = False
        await self._db.flush()

    async def rotate(self, api_key_id: uuid.UUID) -> tuple[ApiKey, str]:
        api_key = await self.get_by_id(api_key_id)
        full_key, key_hash, key_prefix = _generate_api_key()
        api_key.key_hash = key_hash
        api_key.key_prefix = key_prefix
        api_key.last_used_at = None
        await self._db.flush()
        await self._db.refresh(api_key)
        return api_key, full_key
