"""Refresh token issuance and rotation."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.models.models import RefreshToken, User

REFRESH_TOKEN_DAYS = 14


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def issue_refresh_token(session: AsyncSession, user: User) -> str:
    raw = secrets.token_urlsafe(48)
    token = RefreshToken(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash=_hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
    )
    session.add(token)
    await session.flush()
    return raw


async def rotate_refresh_token(
    session: AsyncSession, raw_token: str
) -> tuple[User, str] | None:
    token_hash = _hash_token(raw_token.strip())
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    row = result.scalars().first()
    if row is None or row.revoked_at is not None:
        return None
    if row.expires_at < datetime.now(timezone.utc):
        return None

    user = await session.get(User, row.user_id)
    if user is None or not user.is_active:
        return None

    row.revoked_at = datetime.now(timezone.utc)
    new_raw = await issue_refresh_token(session, user)
    await session.commit()
    return user, new_raw


async def revoke_refresh_token(session: AsyncSession, raw_token: str) -> None:
    token_hash = _hash_token(raw_token.strip())
    result = await session.execute(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    )
    row = result.scalars().first()
    if row and row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        await session.commit()
