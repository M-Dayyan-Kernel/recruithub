"""Refresh token persistence."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import REFRESH_TOKEN_DAYS
from app.models.models import RefreshToken, User


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class RefreshTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_hash(self, token_hash: str) -> RefreshToken | None:
        result = await self._session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        return result.scalars().first()

    async def get_user_for_token(self, user_id: uuid.UUID) -> User | None:
        result = await self._session.execute(
            select(User).options(selectinload(User.tenant)).where(User.id == user_id)
        )
        return result.scalars().first()

    def create_token(self, user_id: uuid.UUID) -> tuple[RefreshToken, str]:
        raw = secrets.token_urlsafe(48)
        token = RefreshToken(
            id=uuid.uuid4(),
            user_id=user_id,
            token_hash=hash_refresh_token(raw),
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
        )
        self._session.add(token)
        return token, raw

    async def revoke(self, row: RefreshToken, *, at: datetime | None = None) -> None:
        if row.revoked_at is None:
            row.revoked_at = at or datetime.now(timezone.utc)

    async def flush(self) -> None:
        await self._session.flush()
