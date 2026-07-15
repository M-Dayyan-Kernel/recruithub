"""Create tenants, per-tenant settings, and invitation helpers."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.tenancy import ensure_unique_slug
from app.models.models import SystemSettings, Tenant, TenantInvite, User

INVITE_TTL_DAYS = 7
PLATFORM_TENANT_SLUG = "platform"


async def ensure_platform_tenant(db: AsyncSession) -> Tenant:
    """Home organization for platform superadmins (not a customer org)."""
    result = await db.execute(select(Tenant).where(Tenant.slug == PLATFORM_TENANT_SLUG).limit(1))
    tenant = result.scalars().first()
    if tenant:
        return tenant
    tenant = Tenant(name="Platform", slug=PLATFORM_TENANT_SLUG, is_active=True)
    db.add(tenant)
    await db.flush()
    db.add(
        SystemSettings(
            tenant_id=tenant.id,
            allowed_phone_regions=["IN"],
            enforce_phone_geography=True,
            screening_enabled=False,
            screening_max_retries=3,
            screening_retry_delay_seconds=1800,
            company_name="Platform",
        )
    )
    await db.flush()
    return tenant


async def create_tenant_with_admin(
    db: AsyncSession,
    *,
    organization_name: str,
    email: str,
    password: str,
    full_name: str,
) -> tuple[Tenant, User]:
    """Create a tenant, default settings, and first admin user."""
    name = organization_name.strip()
    slug = await ensure_unique_slug(db, name)
    tenant = Tenant(name=name, slug=slug)
    db.add(tenant)
    await db.flush()

    settings_row = SystemSettings(
        tenant_id=tenant.id,
        allowed_phone_regions=["IN"],
        enforce_phone_geography=True,
        screening_enabled=True,
        screening_max_retries=3,
        screening_retry_delay_seconds=1800,
        company_name=name,
    )
    db.add(settings_row)

    admin = User(
        tenant_id=tenant.id,
        email=email.strip().lower(),
        full_name=full_name.strip(),
        hashed_password=hash_password(password),
        role="admin",
        is_active=True,
    )
    db.add(admin)
    await db.flush()
    return tenant, admin


async def create_invite(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    email: str,
    role: str,
    invited_by: User,
) -> TenantInvite:
    invite = TenantInvite(
        tenant_id=tenant_id,
        email=email.strip().lower(),
        role=role,
        token=secrets.token_urlsafe(32),
        invited_by_user_id=invited_by.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS),
    )
    db.add(invite)
    await db.flush()
    return invite


async def get_valid_invite(db: AsyncSession, token: str) -> TenantInvite | None:
    result = await db.execute(select(TenantInvite).where(TenantInvite.token == token))
    invite = result.scalars().first()
    if invite is None or invite.accepted_at is not None:
        return None
    expires = invite.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        return None
    return invite


async def get_or_create_default_tenant(db: AsyncSession) -> Tenant:
    """Used by seed admin — prefer existing default slug, else first tenant, else create."""
    result = await db.execute(select(Tenant).where(Tenant.slug == "default").limit(1))
    tenant = result.scalars().first()
    if tenant:
        return tenant
    result = await db.execute(select(Tenant).order_by(Tenant.created_at.asc()).limit(1))
    tenant = result.scalars().first()
    if tenant:
        return tenant
    tenant = Tenant(name="Default Organization", slug="default")
    db.add(tenant)
    await db.flush()
    db.add(
        SystemSettings(
            tenant_id=tenant.id,
            allowed_phone_regions=["IN"],
            enforce_phone_geography=True,
            screening_enabled=True,
            screening_max_retries=3,
            screening_retry_delay_seconds=1800,
            company_name="Webknot Technologies",
        )
    )
    await db.flush()
    return tenant
