"""Platform-level APIs for superadmin organization management."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import PLATFORM_TENANT_SLUG, RequireSuperAdmin
from app.models.models import Job, SystemSettings, Tenant, User
from app.schemas.schemas import (
    TenantCreateRequest,
    TenantListItem,
    TenantResponse,
    TenantUpdateRequest,
    UserResponse,
)
from app.services.audit_service import log_change
from app.services.tenant_service import create_tenant_with_admin

router = APIRouter()


@router.get("/tenants", response_model=list[TenantListItem])
async def list_tenants(
    _admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    user_counts = (
        await db.execute(
            select(User.tenant_id, func.count())
            .where(User.role != "superadmin")
            .group_by(User.tenant_id)
        )
    ).all()
    job_counts = (
        await db.execute(select(Job.tenant_id, func.count()).group_by(Job.tenant_id))
    ).all()
    users_by_tenant = {tid: n for tid, n in user_counts}
    jobs_by_tenant = {tid: n for tid, n in job_counts}

    result = await db.execute(
        select(Tenant).where(Tenant.slug != PLATFORM_TENANT_SLUG).order_by(Tenant.created_at.desc())
    )
    tenants = result.scalars().all()
    return [
        TenantListItem(
            id=t.id,
            name=t.name,
            slug=t.slug,
            is_active=t.is_active,
            created_at=t.created_at,
            user_count=users_by_tenant.get(t.id, 0),
            job_count=jobs_by_tenant.get(t.id, 0),
        )
        for t in tenants
    ]


@router.post("/tenants", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreateRequest,
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    email = body.admin_email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    tenant, org_admin = await create_tenant_with_admin(
        db,
        organization_name=body.name,
        email=email,
        password=body.admin_password,
        full_name=body.admin_full_name,
    )
    await log_change(
        db,
        actor=admin,
        action="tenant.created",
        entity_type="tenant",
        entity_id=tenant.id,
        subject_label=tenant.name,
        feature="platform",
        before=None,
        after={"name": tenant.name, "slug": tenant.slug, "admin_email": org_admin.email},
    )
    await db.commit()
    await db.refresh(tenant)
    return TenantResponse.model_validate(tenant)


@router.patch("/tenants/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: uuid.UUID,
    body: TenantUpdateRequest,
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.slug == PLATFORM_TENANT_SLUG:
        raise HTTPException(status_code=404, detail="Organization not found")

    data = body.model_dump(exclude_unset=True)
    before = {"name": tenant.name, "is_active": tenant.is_active}
    if "name" in data and data["name"] is not None:
        tenant.name = data["name"].strip()
    if "is_active" in data and data["is_active"] is not None:
        tenant.is_active = data["is_active"]

    await log_change(
        db,
        actor=admin,
        action="tenant.updated",
        entity_type="tenant",
        entity_id=tenant.id,
        subject_label=tenant.name,
        feature="platform",
        before=before,
        after={"name": tenant.name, "is_active": tenant.is_active},
    )
    await db.commit()
    await db.refresh(tenant)
    return TenantResponse.model_validate(tenant)


@router.get("/tenants/{tenant_id}/users", response_model=list[UserResponse])
async def list_tenant_users(
    tenant_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.slug == PLATFORM_TENANT_SLUG:
        raise HTTPException(status_code=404, detail="Organization not found")

    result = await db.execute(
        select(User)
        .where(User.tenant_id == tenant_id, User.role != "superadmin")
        .order_by(User.created_at.asc())
    )
    return [UserResponse.model_validate(u) for u in result.scalars().all()]


@router.delete("/tenants/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant(
    tenant_id: uuid.UUID,
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete an organization and all related data (users, jobs, etc.)."""
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.slug == PLATFORM_TENANT_SLUG:
        raise HTTPException(status_code=404, detail="Organization not found")

    label = tenant.name
    slug = tenant.slug
    await log_change(
        db,
        actor=admin,
        action="tenant.deleted",
        entity_type="tenant",
        entity_id=tenant.id,
        subject_label=label,
        feature="platform",
        before={"name": label, "slug": slug, "is_active": tenant.is_active},
        after=None,
    )
    # Clear settings first — ORM default is to nullify FKs, which violates NOT NULL
    await db.execute(delete(SystemSettings).where(SystemSettings.tenant_id == tenant_id))
    await db.delete(tenant)
    await db.commit()
    return None
