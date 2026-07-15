from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token, verify_password
from app.models.models import Tenant, User
from app.schemas.schemas import (
    AcceptInviteRequest,
    InvitePublicResponse,
    LoginRequest,
    SignupRequest,
    TokenResponse,
    UserResponse,
)
from app.services.tenant_service import create_tenant_with_admin, get_valid_invite

router = APIRouter()


def _user_response(user: User, tenant_name: str | None = None) -> UserResponse:
    data = UserResponse.model_validate(user)
    if tenant_name is not None:
        data.tenant_name = tenant_name
    elif user.tenant is not None:
        data.tenant_name = user.tenant.name
    return data


def _issue_token(user: User, tenant_name: str | None = None) -> TokenResponse:
    token = create_access_token(
        subject=str(user.id),
        extra_claims={
            "role": user.role,
            "email": user.email,
            "tenant_id": str(user.tenant_id),
        },
    )
    return TokenResponse(
        access_token=token,
        user=_user_response(user, tenant_name=tenant_name),
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

    return _issue_token(user)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tenant_name = None
    if current_user.tenant_id:
        tenant = await db.get(Tenant, current_user.tenant_id)
        if tenant:
            tenant_name = tenant.name
    return _user_response(current_user, tenant_name=tenant_name)


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
