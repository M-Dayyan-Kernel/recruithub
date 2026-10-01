"""Refresh token issuance and rotation."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import DomainError
from app.models.models import User
from app.repositories.refresh_token_repository import (
    RefreshTokenRepository,
    hash_refresh_token,
)
from app.services.tenant_access_policy import TenantAccessPolicy


class RefreshTokenService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        repo: RefreshTokenRepository | None = None,
        access_policy: TenantAccessPolicy | None = None,
    ) -> None:
        self._session = session
        self._repo = repo or RefreshTokenRepository(session)
        self._access_policy = access_policy or TenantAccessPolicy()

    async def issue(self, user: User) -> str:
        _, raw = self._repo.create_token(user.id)
        await self._repo.flush()
        return raw

    async def rotate(self, raw_token: str) -> tuple[User, str] | None:
        row = await self._repo.get_by_hash(hash_refresh_token(raw_token.strip()))
        if row is None or row.revoked_at is not None:
            return None
        if row.expires_at < datetime.now(timezone.utc):
            return None
        user = await self._repo.get_user_for_token(row.user_id)
        if user is None or not user.is_active:
            return None
        if user.role != "superadmin":
            try:
                self._access_policy.assert_can_access(user.tenant)
            except DomainError:
                # Organization deactivated/rejected since the token was issued:
                # burn it so the session cannot be extended.
                await self._repo.revoke(row)
                return None
        await self._repo.revoke(row)
        new_raw = await self.issue(user)
        return user, new_raw

    async def revoke(self, raw_token: str) -> None:
        row = await self._repo.get_by_hash(hash_refresh_token(raw_token.strip()))
        if row:
            await self._repo.revoke(row)


# --- backward-compatible module shims -----------------------------------------
async def issue_refresh_token(session: AsyncSession, user: User) -> str:
    return await RefreshTokenService(session).issue(user)


async def rotate_refresh_token(
    session: AsyncSession, raw_token: str
) -> tuple[User, str] | None:
    service = RefreshTokenService(session)
    rotated = await service.rotate(raw_token)
    if rotated is not None:
        await session.commit()
    return rotated


async def revoke_refresh_token(session: AsyncSession, raw_token: str) -> None:
    service = RefreshTokenService(session)
    await service.revoke(raw_token)
    await session.commit()
