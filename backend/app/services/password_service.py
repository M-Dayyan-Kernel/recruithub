"""Password set/reset links and password changes.

Owns the token lifecycle (issue, inspect, redeem) and the rules around changing
a password. It does not send mail: it returns what should be sent, so callers
decide when (and whether) to deliver it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_utils import run_sync
from app.core.constants import (
    PASSWORD_ONBOARDING_TTL_DAYS,
    PASSWORD_RESET_COOLDOWN_SECONDS,
    PASSWORD_RESET_TTL_MINUTES,
)
from app.core.security import hash_password, verify_password
from app.exceptions import BadRequestError, DomainError, NotFoundError
from app.models.models import User
from app.repositories.password_token_repository import (
    PasswordTokenRepository,
    hash_password_token,
)
from app.repositories.refresh_token_repository import RefreshTokenRepository
from app.repositories.user_repository import UserRepository
from app.services.app_links import set_password_url
from app.services.tenant_access_policy import TenantAccessPolicy

logger = logging.getLogger(__name__)

PURPOSE_ONBOARDING = "onboarding"
PURPOSE_RESET = "reset"

_INVALID_LINK = "This link is invalid or has expired. Request a new one."


@dataclass(frozen=True)
class ResetEmail:
    """What to send after a reset request - the caller delivers it."""

    to_email: str
    full_name: str
    reset_url: str
    expires_minutes: int


@dataclass(frozen=True)
class TokenInfo:
    email: str
    purpose: str


def _ttl_for(purpose: str) -> timedelta:
    if purpose == PURPOSE_ONBOARDING:
        return timedelta(days=PASSWORD_ONBOARDING_TTL_DAYS)
    return timedelta(minutes=PASSWORD_RESET_TTL_MINUTES)


class PasswordService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        user_repo: UserRepository | None = None,
        token_repo: PasswordTokenRepository | None = None,
        refresh_repo: RefreshTokenRepository | None = None,
        access_policy: TenantAccessPolicy | None = None,
    ) -> None:
        self._session = session
        self._users = user_repo or UserRepository(session)
        self._tokens = token_repo or PasswordTokenRepository(session)
        self._refresh = refresh_repo or RefreshTokenRepository(session)
        self._access_policy = access_policy or TenantAccessPolicy()

    # ── issuing ───────────────────────────────────────────────────────────

    async def issue_token(self, user: User, purpose: str) -> str:
        """Stage a fresh link for ``user`` and retire any earlier ones.

        The caller commits, so issuing is atomic with whatever created the
        user. Returns the raw token (only its hash is stored).
        """
        await self._tokens.invalidate_unused_for_user(user.id)
        _, raw = self._tokens.create(user.id, purpose, _ttl_for(purpose))
        await self._tokens.flush()
        return raw

    async def request_reset(self, email: str) -> ResetEmail | None:
        """Start a reset. Returns the email to send, or None.

        None covers every non-actionable case (unknown address, inactive user,
        deactivated organization, a link sent a moment ago). The HTTP layer
        answers all of them identically, so the response never reveals which
        addresses have accounts.
        """
        user = await self._users.get_by_email(email, load_tenant=True)
        if user is None or not user.is_active:
            return None
        if user.role != "superadmin":
            try:
                self._access_policy.assert_can_access(user.tenant)
            except DomainError:
                return None

        cutoff = datetime.now(timezone.utc) - timedelta(
            seconds=PASSWORD_RESET_COOLDOWN_SECONDS
        )
        if await self._tokens.issued_since(user.id, cutoff):
            return None

        raw = await self.issue_token(user, PURPOSE_RESET)
        await self._session.commit()
        return ResetEmail(
            to_email=user.email,
            full_name=user.full_name,
            reset_url=set_password_url(raw),
            expires_minutes=PASSWORD_RESET_TTL_MINUTES,
        )

    # ── redeeming ─────────────────────────────────────────────────────────

    async def describe_token(self, raw_token: str) -> TokenInfo:
        row = await self._tokens.get_valid_by_hash(hash_password_token(raw_token.strip()))
        if row is None:
            raise NotFoundError(public_message=_INVALID_LINK)
        user = await self._users.get_by_id(row.user_id)
        if user is None or not user.is_active:
            raise NotFoundError(public_message=_INVALID_LINK)
        return TokenInfo(email=user.email, purpose=row.purpose)

    async def reset_password(self, raw_token: str, new_password: str) -> None:
        consumed = await self._tokens.consume(hash_password_token(raw_token.strip()))
        if consumed is None:
            raise NotFoundError(public_message=_INVALID_LINK)
        user_id, _purpose = consumed
        user = await self._users.get_by_id(user_id)
        if user is None or not user.is_active:
            raise NotFoundError(public_message=_INVALID_LINK)

        await self._set_password(user, new_password)
        await self._session.commit()
        logger.info("Password set via link for user %s", user.id)

    # ── authenticated change ──────────────────────────────────────────────

    async def change_password(
        self, user: User, *, current_password: str, new_password: str
    ) -> None:
        matches = await run_sync(verify_password, current_password, user.hashed_password)
        if not matches:
            # 400, not 401: the client treats 401 as "session expired" and logs out.
            raise BadRequestError(public_message="Current password is incorrect")
        if current_password == new_password:
            raise BadRequestError(
                public_message="Choose a password different from your current one"
            )
        await self._set_password(user, new_password)
        # The caller issues the replacement session and commits.

    # ── internals ─────────────────────────────────────────────────────────

    async def _set_password(self, user: User, new_password: str) -> None:
        user.hashed_password = await run_sync(hash_password, new_password)
        # A changed password must end every other session and every open link.
        await self._refresh.revoke_all_for_user(user.id)
        await self._tokens.invalidate_unused_for_user(user.id)
