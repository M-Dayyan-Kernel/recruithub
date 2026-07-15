from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import RequireSuperAdmin, get_current_user
from app.core.security import create_access_token, verify_password
from app.models.models import Tenant, User
from app.schemas.schemas import (
    AcceptInviteRequest,
    InvitePublicResponse,
    LoginRequest,
    SignupRequest,
    SwitchTenantRequest,
    TokenResponse,
    UserResponse,
)
from app.services.tenant_service import create_tenant_with_admin, get_valid_invite

router = APIRouter()


def _user_response(user: User, tenant_name: str | None = None) -> UserResponse:
    data = UserResponse.model_validate(user)
    data.tenant_name = tenant_name or getattr(user, "active_tenant_name", None) or (
        user.tenant.name if getattr(user, "tenant", None) else None
    )
    data.home_tenant_id = getattr(user, "home_tenant_id", None) or user.tenant_id
    data.active_tenant_id = getattr(user, "active_tenant_id", None) or user.tenant_id
    data.active_tenant_name = getattr(user, "active_tenant_name", None) or data.tenant_name
    return data


def _issue_token(
    user: User,
    *,
    tenant_name: str | None = None,
    active_tenant_id: str | None = None,
    active_tenant_name: str | None = None,
) -> TokenResponse:
    home_tenant_id = getattr(user, "home_tenant_id", None) or user.tenant_id
    claims = {
        "role": user.role,
        "email": user.email,
        "tenant_id": str(home_tenant_id),
    }
    if active_tenant_id and user.role == "superadmin":
        claims["active_tenant_id"] = active_tenant_id

    # Align response tenant fields with token
    if active_tenant_id and user.role == "superadmin":
        from uuid import UUID

        user.tenant_id = UUID(active_tenant_id)
        user.active_tenant_id = UUID(active_tenant_id)  # type: ignore[attr-defined]
        user.active_tenant_name = active_tenant_name  # type: ignore[attr-defined]
        user.home_tenant_id = home_tenant_id  # type: ignore[attr-defined]

    token = create_access_token(subject=str(user.id), extra_claims=claims)
    return TokenResponse(
        access_token=token,
        user=_user_response(user, tenant_name=active_tenant_name or tenant_name),
    )


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    tenant, admin = await create_tenant_with_admin(
        db,
        organization_name=body.organization_name,
        email=email,
        password=body.password,
        full_name=body.full_name,
    )
    await db.commit()
    await db.refresh(admin)
    return _issue_token(admin, tenant_name=tenant.name)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    result = await db.execute(
        select(User).options(selectinload(User.tenant)).where(User.email == email)
    )
    user = result.scalars().first()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    if user.role != "superadmin" and user.tenant and not user.tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization is inactive",
        )

    return _issue_token(user, tenant_name=user.tenant.name if user.tenant else None)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return _user_response(current_user)


@router.post("/switch-tenant", response_model=TokenResponse)
async def switch_tenant(
    body: SwitchTenantRequest,
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    from app.core.deps import PLATFORM_TENANT_SLUG

    tenant = await db.get(Tenant, body.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not tenant.is_active:
        raise HTTPException(status_code=400, detail="Organization is inactive")
    if tenant.slug == PLATFORM_TENANT_SLUG:
        raise HTTPException(status_code=400, detail="Cannot switch into the platform tenant")

    home_id = getattr(admin, "home_tenant_id", None) or admin.tenant_id
    admin.home_tenant_id = home_id  # type: ignore[attr-defined]
    return _issue_token(
        admin,
        tenant_name=tenant.name,
        active_tenant_id=str(tenant.id),
        active_tenant_name=tenant.name,
    )


@router.post("/clear-tenant-switch", response_model=TokenResponse)
async def clear_tenant_switch(
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    home_id = getattr(admin, "home_tenant_id", None) or admin.tenant_id
    tenant = await db.get(Tenant, home_id)
    admin.home_tenant_id = home_id  # type: ignore[attr-defined]
    admin.tenant_id = home_id
    return _issue_token(
        admin,
        tenant_name=tenant.name if tenant else "Platform",
    )


@router.get("/invites/{token}", response_model=InvitePublicResponse)
async def get_invite(token: str, db: AsyncSession = Depends(get_db)):
    invite = await get_valid_invite(db, token)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found or expired")
    tenant = await db.get(Tenant, invite.tenant_id)
    return InvitePublicResponse(
        email=invite.email,
        role=invite.role,  # type: ignore[arg-type]
        organization_name=tenant.name if tenant else "Organization",
        expires_at=invite.expires_at,
    )


@router.post("/accept-invite", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def accept_invite(body: AcceptInviteRequest, db: AsyncSession = Depends(get_db)):
    invite = await get_valid_invite(db, body.token.strip())
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found or expired")

    email = invite.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    from datetime import datetime, timezone

    from app.core.security import hash_password

    user = User(
        tenant_id=invite.tenant_id,
        email=email,
        full_name=body.full_name.strip(),
        hashed_password=hash_password(body.password),
        role=invite.role,
        is_active=True,
    )
    invite.accepted_at = datetime.now(timezone.utc)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    tenant = await db.get(Tenant, user.tenant_id)
    return _issue_token(user, tenant_name=tenant.name if tenant else None)
