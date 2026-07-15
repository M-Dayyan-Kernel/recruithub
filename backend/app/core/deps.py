from typing import Annotated, Callable
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import decode_token
from app.models.models import Tenant, User

bearer_scheme = HTTPBearer(auto_error=False)

PLATFORM_TENANT_SLUG = "platform"


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(credentials.credentials)
        user_id = UUID(str(payload["sub"]))
    except (ValueError, KeyError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(
        select(User).options(selectinload(User.tenant)).where(User.id == user_id)
    )
    user = result.scalars().first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    if user.role != "superadmin" and user.tenant:
        status_value = getattr(user.tenant, "verification_status", "approved") or "approved"
        if status_value == "pending":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Organization is pending platform approval. "
                    "You will get access once approved."
                ),
            )
        if status_value == "rejected":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organization registration was rejected",
            )
        if not user.tenant.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organization is inactive",
            )

    home_tenant_id = user.tenant_id
    home_tenant_name = user.tenant.name if user.tenant else None
    active_tenant_id = home_tenant_id
    active_tenant_name = home_tenant_name

    # Detach so request-only tenant switch is never flushed to DB
    db.expunge(user)

    if user.role == "superadmin":
        active_raw = payload.get("active_tenant_id")
        if active_raw:
            try:
                switch_id = UUID(str(active_raw))
            except ValueError:
                switch_id = None
            if switch_id and switch_id != home_tenant_id:
                tenant = await db.get(Tenant, switch_id)
                if tenant is None or not tenant.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Active organization is missing or inactive",
                    )
                if tenant.slug == PLATFORM_TENANT_SLUG:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cannot switch into the platform tenant",
                    )
                user.tenant_id = tenant.id
                active_tenant_id = tenant.id
                active_tenant_name = tenant.name

    # Request-scoped helpers for responses (not mapped columns)
    user.home_tenant_id = home_tenant_id  # type: ignore[attr-defined]
    user.home_tenant_name = home_tenant_name  # type: ignore[attr-defined]
    user.active_tenant_id = active_tenant_id  # type: ignore[attr-defined]
    user.active_tenant_name = active_tenant_name  # type: ignore[attr-defined]

    return user


def require_roles(*allowed_roles: str) -> Callable:
    async def _checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _checker


RequireAdminOrHr = Annotated[User, Depends(require_roles("admin", "hr", "superadmin"))]
RequireAdmin = Annotated[User, Depends(require_roles("admin", "superadmin"))]
RequireSuperAdmin = Annotated[User, Depends(require_roles("superadmin"))]

# Reuse in router-level Depends(...) so superadmin can act inside a tenant
hr_roles = require_roles("admin", "hr", "superadmin")
admin_roles = require_roles("admin", "superadmin")
