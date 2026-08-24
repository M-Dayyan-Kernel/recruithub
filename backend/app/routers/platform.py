"""Platform-level APIs for superadmin organization management."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.dependencies import (
    RequireSuperAdmin,
    get_platform_connections_service,
    get_platform_tenant_service,
)
from app.exceptions import DomainError
from app.schemas.schemas import (
    PlatformConnectionItem,
    TenantCreateRequest,
    TenantListItem,
    TenantResponse,
    TenantUpdateRequest,
    UserResponse,
)
from app.services.platform_connections_service import PlatformConnectionsService
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


@router.get("/connections", response_model=list[PlatformConnectionItem])
async def list_connections(
    _admin: RequireSuperAdmin,
    service: PlatformConnectionsService = Depends(get_platform_connections_service),
):
    return await service.list_connections()


@router.post("/tenants/{tenant_id}/connections/connect")
async def connect_tenant(
    tenant_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    service: PlatformConnectionsService = Depends(get_platform_connections_service),
):
    try:
        return await service.connect_tenant(tenant_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/tenants/{tenant_id}/connections/disconnect")
async def disconnect_tenant(
    tenant_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    service: PlatformConnectionsService = Depends(get_platform_connections_service),
):
    try:
        return await service.disconnect_tenant(tenant_id)
    except DomainError as exc:
        _raise_domain(exc)


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
