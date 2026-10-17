"""Platform-level APIs for superadmin organization management."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, status

from app.dependencies import (
    RequireSuperAdmin,
    get_integrity_service,
    get_observed_extension_service,
    get_platform_tenant_service,
)
from app.exceptions import DomainError
from app.schemas.schemas import (
    TenantCreateRequest,
    TenantListItem,
    TenantResponse,
    TenantUpdateRequest,
    UserResponse,
)
from app.schemas.integrity import (
    BlocklistEntryCreate,
    BlocklistEntryResponse,
    BlocklistEntryUpdate,
    ObservedExtensionPage,
    ObservedExtensionResponse,
    PolicyAdminResponse,
    PolicyUpdateRequest,
)
from app.services.integrity_service import IntegrityService
from app.services.observed_extension_service import ObservedExtensionService
from app.services.platform_tenant_service import PlatformTenantService

router = APIRouter()


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.get("/tenants", response_model=list[TenantListItem])
async def list_tenants(
    _admin: RequireSuperAdmin,
    service: PlatformTenantService = Depends(get_platform_tenant_service),
):
    return await service.list_tenants()


@router.post("/tenants", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreateRequest,
    admin: RequireSuperAdmin,
    service: PlatformTenantService = Depends(get_platform_tenant_service),
):
    try:
        return await service.create_tenant(body, admin)
    except DomainError as exc:
        _raise_domain(exc)


@router.patch("/tenants/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: uuid.UUID,
    body: TenantUpdateRequest,
    admin: RequireSuperAdmin,
    service: PlatformTenantService = Depends(get_platform_tenant_service),
):
    try:
        return await service.update_tenant(tenant_id, body, admin)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/tenants/{tenant_id}/approve", response_model=TenantResponse)
async def approve_tenant(
    tenant_id: uuid.UUID,
    admin: RequireSuperAdmin,
    service: PlatformTenantService = Depends(get_platform_tenant_service),
):
    try:
        return await service.approve_tenant(tenant_id, admin)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/tenants/{tenant_id}/reject", response_model=TenantResponse)
async def reject_tenant(
    tenant_id: uuid.UUID,
    admin: RequireSuperAdmin,
    service: PlatformTenantService = Depends(get_platform_tenant_service),
):
    try:
        return await service.reject_tenant(tenant_id, admin)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/tenants/{tenant_id}/gst-document")
async def download_gst_document(
    tenant_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    service: PlatformTenantService = Depends(get_platform_tenant_service),
):
    try:
        return await service.download_gst_document(tenant_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/tenants/{tenant_id}/users", response_model=list[UserResponse])
async def list_tenant_users(
    tenant_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    service: PlatformTenantService = Depends(get_platform_tenant_service),
):
    try:
        return await service.list_tenant_users(tenant_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.delete("/tenants/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant(
    tenant_id: uuid.UUID,
    admin: RequireSuperAdmin,
    service: PlatformTenantService = Depends(get_platform_tenant_service),
):
    try:
        await service.delete_tenant(tenant_id, admin)
    except DomainError as exc:
        _raise_domain(exc)


# ── AI-assistant extension detection (policy + blocklist) ────────────────────


@router.get("/extension-policy", response_model=PolicyAdminResponse)
async def get_extension_policy(
    _admin: RequireSuperAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.admin_policy()


@router.put("/extension-policy", response_model=PolicyAdminResponse)
async def update_extension_policy(
    body: PolicyUpdateRequest,
    admin: RequireSuperAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.update_policy(body, admin)


@router.get("/extension-blocklist", response_model=list[BlocklistEntryResponse])
async def list_extension_blocklist(
    _admin: RequireSuperAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.list_blocklist()


@router.post(
    "/extension-blocklist",
    response_model=BlocklistEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_extension_blocklist_entry(
    body: BlocklistEntryCreate,
    admin: RequireSuperAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.add_entry(body, admin)


@router.patch("/extension-blocklist/{entry_id}", response_model=BlocklistEntryResponse)
async def update_extension_blocklist_entry(
    entry_id: uuid.UUID,
    body: BlocklistEntryUpdate,
    admin: RequireSuperAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.update_entry(entry_id, body, admin)


@router.delete("/extension-blocklist/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_extension_blocklist_entry(
    entry_id: uuid.UUID,
    admin: RequireSuperAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    await service.delete_entry(entry_id, admin)


# ── Seen extensions: flagged on candidates' browsers, awaiting a decision ────


@router.get("/observed-extensions", response_model=ObservedExtensionPage)
async def list_observed_extensions(
    _admin: RequireSuperAdmin,
    status_filter: Literal["new", "dismissed"] = Query("new", alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    service: ObservedExtensionService = Depends(get_observed_extension_service),
):
    return await service.list_page(status=status_filter, limit=limit, offset=offset)


@router.post(
    "/observed-extensions/{extension_row_id}/dismiss", response_model=ObservedExtensionResponse
)
async def dismiss_observed_extension(
    extension_row_id: uuid.UUID,
    admin: RequireSuperAdmin,
    service: ObservedExtensionService = Depends(get_observed_extension_service),
):
    return await service.dismiss(extension_row_id, admin)


@router.post(
    "/observed-extensions/{extension_row_id}/restore", response_model=ObservedExtensionResponse
)
async def restore_observed_extension(
    extension_row_id: uuid.UUID,
    admin: RequireSuperAdmin,
    service: ObservedExtensionService = Depends(get_observed_extension_service),
):
    return await service.restore(extension_row_id, admin)
