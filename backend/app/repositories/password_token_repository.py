"""Password set/reset token persistence."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import PasswordToken


def hash_password_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class PasswordTokenRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def create(
        self,
        user_id: uuid.UUID,
        purpose: str,
        ttl: timedelta,
        *,
        now: datetime | None = None,
    ) -> tuple[PasswordToken, str]:
        """Stage a token. Returns the row and the raw value (shown once, never stored)."""
        issued = now or datetime.now(timezone.utc)
        raw = secrets.token_urlsafe(48)
        row = PasswordToken(
            id=uuid.uuid4(),
            user_id=user_id,
            token_hash=hash_password_token(raw),
            purpose=purpose,
            expires_at=issued + ttl,
        )
        self._session.add(row)
        return row, raw

    async def get_valid_by_hash(
        self, token_hash: str, *, now: datetime | None = None
    ) -> PasswordToken | None:
        """Look a token up without spending it (used to render the reset page)."""
        moment = now or datetime.now(timezone.utc)
        result = await self._session.execute(
            select(PasswordToken).where(
                PasswordToken.token_hash == token_hash,
                PasswordToken.used_at.is_(None),
                PasswordToken.expires_at > moment,
            )
        )
        return result.scalars().first()

    async def consume(
        self, token_hash: str, *, now: datetime | None = None
    ) -> tuple[uuid.UUID, str] | None:
        """Atomically spend a token: validate and mark used in one statement.

        Returns ``(user_id, purpose)``, or None when the token is unknown,
        expired, or already used - so two concurrent redemptions cannot both win.
        """
        moment = now or datetime.now(timezone.utc)
        result = await self._session.execute(
            update(PasswordToken)
            .where(
                PasswordToken.token_hash == token_hash,
                PasswordToken.used_at.is_(None),
                PasswordToken.expires_at > moment,
            )
            .values(used_at=moment)
            .returning(PasswordToken.user_id, PasswordToken.purpose)
            .execution_options(synchronize_session=False)
        )
        row = result.first()
        return (row[0], row[1]) if row else None

    async def invalidate_unused_for_user(
        self, user_id: uuid.UUID, *, now: datetime | None = None
    ) -> int:
        """Retire every outstanding link for a user (a new one replaces them)."""
        moment = now or datetime.now(timezone.utc)
        result = await self._session.execute(
            update(PasswordToken)
            .where(PasswordToken.user_id == user_id, PasswordToken.used_at.is_(None))
            .values(used_at=moment)
            .execution_options(synchronize_session=False)
        )
        return result.rowcount or 0

    async def issued_since(self, user_id: uuid.UUID, since: datetime) -> bool:
        """True when a token was issued to this user at or after ``since``."""
        result = await self._session.execute(
            select(func.count())
            .select_from(PasswordToken)
            .where(PasswordToken.user_id == user_id, PasswordToken.created_at >= since)
        )
        return (result.scalar_one() or 0) > 0

    async def flush(self) -> None:
        await self._session.flush()
