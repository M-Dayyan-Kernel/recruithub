"""Platform-level APIs for superadmin organization management."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_utils import run_sync
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
from app.services.s3_service import delete_object_async, download_bytes_async, is_s3_object_key
from app.services.tenant_service import create_tenant_with_admin

logger = logging.getLogger(__name__)
router = APIRouter()


def _tenant_list_item(
    t: Tenant,
    user_count: int,
    job_count: int,
    *,
    admin_email: str | None = None,
    admin_full_name: str | None = None,
) -> TenantListItem:
    return TenantListItem(
        id=t.id,
        name=t.name,
        slug=t.slug,
        is_active=t.is_active,
        verification_status=t.verification_status,  # type: ignore[arg-type]
        company_registration_number=t.company_registration_number,
        gst_document_filename=t.gst_document_filename,
        has_gst_document=bool(t.gst_document_path),
        admin_email=admin_email,
        admin_full_name=admin_full_name,
        created_at=t.created_at,
        user_count=user_count,
        job_count=job_count,
    )


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

    # Earliest admin per tenant = the person who registered / was set as first admin
    admin_rows = (
        await db.execute(
            select(User.tenant_id, User.email, User.full_name, User.created_at)
            .where(User.role == "admin")
            .order_by(User.created_at.asc())
        )
    ).all()
    admin_by_tenant: dict = {}
    for tenant_id, email, full_name, _created in admin_rows:
        if tenant_id not in admin_by_tenant:
            admin_by_tenant[tenant_id] = (email, full_name)

    result = await db.execute(
        select(Tenant).where(Tenant.slug != PLATFORM_TENANT_SLUG).order_by(Tenant.created_at.desc())
    )
    tenants = result.scalars().all()
    items: list[TenantListItem] = []
    for t in tenants:
        admin = admin_by_tenant.get(t.id)
        items.append(
            _tenant_list_item(
                t,
                users_by_tenant.get(t.id, 0),
                jobs_by_tenant.get(t.id, 0),
                admin_email=admin[0] if admin else None,
                admin_full_name=admin[1] if admin else None,
            )
        )
    return items


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
        verification_status="approved",
        is_active=True,
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
    before = {
        "name": tenant.name,
        "is_active": tenant.is_active,
        "verification_status": tenant.verification_status,
    }
    if "name" in data and data["name"] is not None:
        tenant.name = data["name"].strip()
    if "is_active" in data and data["is_active"] is not None:
        if data["is_active"] and tenant.verification_status != "approved":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Approve the organization before activating it",
            )
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
        after={
            "name": tenant.name,
            "is_active": tenant.is_active,
            "verification_status": tenant.verification_status,
        },
    )
    await db.commit()
    await db.refresh(tenant)
    return TenantResponse.model_validate(tenant)


@router.post("/tenants/{tenant_id}/approve", response_model=TenantResponse)
async def approve_tenant(
    tenant_id: uuid.UUID,
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.slug == PLATFORM_TENANT_SLUG:
        raise HTTPException(status_code=404, detail="Organization not found")

    before = {
        "verification_status": tenant.verification_status,
        "is_active": tenant.is_active,
    }
    tenant.verification_status = "approved"
    tenant.is_active = True
    await log_change(
        db,
        actor=admin,
        action="tenant.approved",
        entity_type="tenant",
        entity_id=tenant.id,
        subject_label=tenant.name,
        feature="platform",
        before=before,
        after={"verification_status": "approved", "is_active": True},
    )
    await db.commit()
    await db.refresh(tenant)
    return TenantResponse.model_validate(tenant)


@router.post("/tenants/{tenant_id}/reject", response_model=TenantResponse)
async def reject_tenant(
    tenant_id: uuid.UUID,
    admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.slug == PLATFORM_TENANT_SLUG:
        raise HTTPException(status_code=404, detail="Organization not found")

    before = {
        "verification_status": tenant.verification_status,
        "is_active": tenant.is_active,
    }
    tenant.verification_status = "rejected"
    tenant.is_active = False
    await log_change(
        db,
        actor=admin,
        action="tenant.rejected",
        entity_type="tenant",
        entity_id=tenant.id,
        subject_label=tenant.name,
        feature="platform",
        before=before,
        after={"verification_status": "rejected", "is_active": False},
    )
    await db.commit()
    await db.refresh(tenant)
    return TenantResponse.model_validate(tenant)


@router.get("/tenants/{tenant_id}/gst-document")
async def download_gst_document(
    tenant_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    db: AsyncSession = Depends(get_db),
):
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None or tenant.slug == PLATFORM_TENANT_SLUG:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not tenant.gst_document_path:
        raise HTTPException(status_code=404, detail="No GST document uploaded")

    filename = tenant.gst_document_filename or "gst-document.pdf"
    if is_s3_object_key(tenant.gst_document_path):
        try:
            data = await download_bytes_async(tenant.gst_document_path)
        except Exception as exc:
            logger.warning("Failed to download GST from S3 for tenant %s: %s", tenant_id, exc)
            raise HTTPException(status_code=404, detail="GST document file missing in storage") from exc
        return Response(
            content=data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    path = Path(tenant.gst_document_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="GST document file missing on disk")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=filename,
    )


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
    doc_path = tenant.gst_document_path
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
    await db.execute(delete(SystemSettings).where(SystemSettings.tenant_id == tenant_id))
    await db.delete(tenant)
    await db.commit()

    if doc_path:
        try:
            if is_s3_object_key(doc_path):
                await delete_object_async(doc_path)
            else:
                path = Path(doc_path)

                def _cleanup_local_gst() -> None:
                    if path.is_file():
                        path.unlink(missing_ok=True)
                    parent = path.parent
                    if parent.is_dir() and not any(parent.iterdir()):
                        parent.rmdir()

                await run_sync(_cleanup_local_gst)
        except OSError as exc:
            logger.warning(
                "Tenant %s deleted but GST doc cleanup failed: %s", tenant_id, exc
            )
    return None
