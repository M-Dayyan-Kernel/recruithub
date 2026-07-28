"""JWT authentication context resolution for request dependencies."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import PLATFORM_TENANT_SLUG
from app.core.logging import set_actor_context
from app.core.security import decode_token
from app.exceptions import AuthenticationError, AuthorizationError, BadRequestError
from app.models.models import User
from app.repositories.tenant_repository import TenantRepository
from app.repositories.user_repository import UserRepository
from app.services.tenant_access_policy import TenantAccessPolicy


class AuthenticationContextService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        user_repo: UserRepository | None = None,
        tenant_repo: TenantRepository | None = None,
        access_policy: TenantAccessPolicy | None = None,
    ) -> None:
        self._session = session
        self._users = user_repo or UserRepository(session)
        self._tenants = tenant_repo or TenantRepository(session)
        self._access_policy = access_policy or TenantAccessPolicy()

    async def resolve_user_from_token(self, token: str) -> User:
        try:
            payload = decode_token(token)
            user_id = UUID(str(payload["sub"]))
        except (ValueError, KeyError, TypeError) as exc:
            raise AuthenticationError(
                public_message="Invalid or expired token",
            ) from exc

        user = await self._users.get_by_id(user_id, load_tenant=True)
        if user is None:
            raise AuthenticationError(public_message="User not found")

        if not user.is_active:
            raise AuthorizationError(public_message="User account is inactive")

        if user.role != "superadmin":
            self._access_policy.assert_can_access(user.tenant)

        home_tenant_id = user.tenant_id
        home_tenant_name = user.tenant.name if user.tenant else None
        active_tenant_id = home_tenant_id
        active_tenant_name = home_tenant_name

        self._session.expunge(user)

        if user.role == "superadmin":
            active_raw = payload.get("active_tenant_id")
            if active_raw:
                try:
                    switch_id = UUID(str(active_raw))
                except ValueError:
                    switch_id = None
                if switch_id and switch_id != home_tenant_id:
                    tenant = await self._tenants.get_by_id(switch_id)
                    if tenant is None or not tenant.is_active:
                        raise AuthorizationError(
                            public_message="Active organization is missing or inactive",
                        )
                    if tenant.slug == PLATFORM_TENANT_SLUG:
                        raise BadRequestError(
                            public_message="Cannot switch into the platform tenant",
                        )
                    user.tenant_id = tenant.id
                    active_tenant_id = tenant.id
                    active_tenant_name = tenant.name

        user.home_tenant_id = home_tenant_id  # type: ignore[attr-defined]
        user.home_tenant_name = home_tenant_name  # type: ignore[attr-defined]
        user.active_tenant_id = active_tenant_id  # type: ignore[attr-defined]
        user.active_tenant_name = active_tenant_name  # type: ignore[attr-defined]

        set_actor_context(
            user_id=user.id,
            tenant_id=active_tenant_id,
            role=user.role,
            name=user.full_name,
        )
        return user
