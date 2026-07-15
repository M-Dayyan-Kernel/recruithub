from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import RequireAdmin
from app.core.security import hash_password
from app.models.models import Tenant, TenantInvite, User
from app.schemas.schemas import (
    InviteCreateRequest,
    InviteListItem,
    InviteResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from app.services.audit_service import log_change, log_field_changes
from app.services.email_service import send_org_invite_email
from app.services.tenant_service import create_invite

router = APIRouter()


def _invite_url(token: str) -> str:
    base = settings.HR_APP_URL.rstrip("/")
    return f"{base}/accept-invite?token={token}"


@router.get("", response_model=list[UserResponse])
async def list_users(
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .where(User.tenant_id == admin.tenant_id)
        .order_by(User.created_at.asc())
    )
    return [UserResponse.model_validate(u) for u in result.scalars().all()]


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    email = body.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    user = User(
        tenant_id=admin.tenant_id,
        email=email,
        full_name=body.full_name.strip(),
        hashed_password=hash_password(body.password),
        role=body.role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await log_change(
        db,
        actor=admin,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        subject_label=user.email,
        feature="user",
        before=None,
        after={"email": user.email, "full_name": user.full_name, "role": user.role},
    )
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.get("/invites", response_model=list[InviteListItem])
async def list_invites(
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Pending and expired (not yet accepted) invites for this organization."""
    result = await db.execute(
        select(TenantInvite)
        .where(
            TenantInvite.tenant_id == admin.tenant_id,
            TenantInvite.accepted_at.is_(None),
        )
        .order_by(TenantInvite.created_at.desc())
    )
    now = datetime.now(timezone.utc)
    items: list[InviteListItem] = []
    for invite in result.scalars().all():
        expires = invite.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        items.append(
            InviteListItem(
                id=invite.id,
                email=invite.email,
                role=invite.role,  # type: ignore[arg-type]
                invite_url=_invite_url(invite.token),
                expires_at=invite.expires_at,
                created_at=invite.created_at,
                status="pending" if expires > now else "expired",
            )
        )
    return items


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: str,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    import uuid

    try:
        iid = uuid.UUID(invite_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Invite not found")

    invite = await db.get(TenantInvite, iid)
    if invite is None or invite.tenant_id != admin.tenant_id:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.accepted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite already accepted",
        )

    label = invite.email
    await log_change(
        db,
        actor=admin,
        action="user.invite_revoked",
        entity_type="invite",
        entity_id=invite.id,
        subject_label=label,
        feature="user",
        before={"email": label, "role": invite.role},
        after=None,
    )
    await db.delete(invite)
    await db.commit()
    return None


@router.post("/invites", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
async def invite_user(
    body: InviteCreateRequest,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    email = body.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    pending = await db.execute(
        select(TenantInvite).where(
            TenantInvite.tenant_id == admin.tenant_id,
            TenantInvite.email == email,
            TenantInvite.accepted_at.is_(None),
            TenantInvite.expires_at > datetime.now(timezone.utc),
        )
    )
    if pending.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active invite already exists for this email",
        )

    invite = await create_invite(
        db,
        tenant_id=admin.tenant_id,
        email=email,
        role=body.role,
        invited_by=admin,
    )
    await log_change(
        db,
        actor=admin,
        action="user.invited",
        entity_type="invite",
        entity_id=invite.id,
        subject_label=email,
        feature="user",
        before=None,
        after={"email": email, "role": body.role},
    )
    await db.commit()
    await db.refresh(invite)

    invite_url = _invite_url(invite.token)
    tenant = await db.get(Tenant, admin.tenant_id)
    org_name = (
        getattr(admin, "active_tenant_name", None)
        or (tenant.name if tenant else None)
        or "your organization"
    )
    email_sent = await send_org_invite_email(
        email,
        organization_name=org_name,
        role=invite.role,
        invite_url=invite_url,
        invited_by_name=admin.full_name,
    )

    return InviteResponse(
        id=invite.id,
        email=invite.email,
        role=invite.role,  # type: ignore[arg-type]
        token=invite.token,
        invite_url=invite_url,
        expires_at=invite.expires_at,
        created_at=invite.created_at,
        email_sent=email_sent,
    )


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    body: UserUpdate,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    import uuid

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found")

    user = await db.get(User, uid)
    if user is None or user.tenant_id != admin.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")

    data = body.model_dump(exclude_unset=True)
    changes: dict = {}

    if "password" in data:
        password = data.pop("password")
        if password:
            user.hashed_password = hash_password(password)
            changes["password"] = (None, "[redacted]")
    if "full_name" in data and data["full_name"] is not None:
        before = user.full_name
        user.full_name = data["full_name"].strip()
        changes["full_name"] = (before, user.full_name)
    if "role" in data and data["role"] is not None:
        if user.id == admin.id and data["role"] != "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change your own role away from admin",
            )
        before = user.role
        user.role = data["role"]
        changes["role"] = (before, user.role)
    if "is_active" in data and data["is_active"] is not None:
        if user.id == admin.id and data["is_active"] is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate your own account",
            )
        before = user.is_active
        user.is_active = data["is_active"]
        changes["is_active"] = (before, user.is_active)

    await log_field_changes(
        db,
        actor=admin,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        subject_label=user.email,
        changes=changes,
    )
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    import uuid

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found")

    user = await db.get(User, uid)
    if user is None or user.tenant_id != admin.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )
    label = user.email
    await log_change(
        db,
        actor=admin,
        action="user.deleted",
        entity_type="user",
        entity_id=user.id,
        subject_label=label,
        feature="user",
        before={"email": label, "role": user.role, "full_name": user.full_name},
        after=None,
    )
    await db.delete(user)
    await db.commit()
