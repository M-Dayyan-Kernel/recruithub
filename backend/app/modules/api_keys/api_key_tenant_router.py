"""Tenant-scoped API key management for tenant admins.

Lives at ``/api/tenant/app-keys`` — a namespace fully disjoint from
recruithub's superadmin-only ``/api/app-keys`` router. Only ``admin`` role
callers are allowed (tenant admins); superadmins are intentionally blocked.

Reuses recruithub's ApiKeyService for persistence and auth — no changes to
their router, schemas, or models.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies import require_roles
from app.exceptions import DomainError
from app.models.api_key import ApiKey
from app.models.models import User
from app.modules.api_keys.api_key_schema import CreateApiKeyRequest, UpdateApiKeyRequest
from app.modules.api_keys.api_key_service import ApiKeyService

router = APIRouter()

TenantAdmin = Annotated[User, Depends(require_roles("admin"))]


def _get_service(db: AsyncSession = Depends(get_db)) -> ApiKeyService:
    return ApiKeyService(db)


def _raise_domain(exc: DomainError):
    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


class TenantApiKeyResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    key_prefix: str
    is_active: bool
    last_used_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class TenantApiKeyCreatedResponse(TenantApiKeyResponse):
    full_key: str


class TenantApiKeyListResponse(BaseModel):
    data: list[TenantApiKeyResponse]
    total: int


def _to_response(key: ApiKey) -> TenantApiKeyResponse:
    return TenantApiKeyResponse(
        id=key.id,
        name=key.name,
        description=key.description,
        key_prefix=key.key_prefix,
        is_active=key.is_active,
        last_used_at=key.last_used_at,
        created_at=key.created_at,
        updated_at=key.updated_at,
    )


async def _get_owned_key(
    service: ApiKeyService, key_id: uuid.UUID, tenant_id: uuid.UUID
) -> ApiKey:
    key = await service.get_by_id(key_id)
    if key.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This app key does not belong to your organization",
        )
    return key


@router.get("", response_model=TenantApiKeyListResponse)
async def list_tenant_api_keys(
    admin: TenantAdmin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.tenant_id == admin.tenant_id)
        .order_by(ApiKey.created_at.desc())
    )
    keys = list(result.scalars().all())
    return TenantApiKeyListResponse(data=[_to_response(k) for k in keys], total=len(keys))


@router.post("", response_model=TenantApiKeyCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant_api_key(
    body: CreateApiKeyRequest,
    admin: TenantAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        key, full_key = await service.create(
            body, created_by_user_id=admin.id, tenant_id=admin.tenant_id
        )
        return TenantApiKeyCreatedResponse(
            **_to_response(key).model_dump(),
            full_key=full_key,
        )
    except DomainError as exc:
        _raise_domain(exc)


@router.patch("/{api_key_id}", response_model=TenantApiKeyResponse)
async def update_tenant_api_key(
    api_key_id: uuid.UUID,
    body: UpdateApiKeyRequest,
    admin: TenantAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        await _get_owned_key(service, api_key_id, admin.tenant_id)
        key = await service.update(api_key_id, body)
        return _to_response(key)
    except DomainError as exc:
        _raise_domain(exc)


@router.delete("/{api_key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_tenant_api_key(
    api_key_id: uuid.UUID,
    admin: TenantAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        await _get_owned_key(service, api_key_id, admin.tenant_id)
        await service.revoke(api_key_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/{api_key_id}/rotate", response_model=TenantApiKeyCreatedResponse)
async def rotate_tenant_api_key(
    api_key_id: uuid.UUID,
    admin: TenantAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        await _get_owned_key(service, api_key_id, admin.tenant_id)
        key, full_key = await service.rotate(api_key_id)
        return TenantApiKeyCreatedResponse(
            **_to_response(key).model_dump(),
            full_key=full_key,
        )
    except DomainError as exc:
        _raise_domain(exc)
