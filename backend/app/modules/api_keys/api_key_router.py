from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies import RequireSuperAdmin, require_roles
from app.exceptions import DomainError
from app.modules.api_keys.api_key_schema import (
    ApiKeyCreatedResponse,
    ApiKeyListResponse,
    ApiKeyResponse,
    CreateApiKeyRequest,
    UpdateApiKeyRequest,
)
from app.modules.api_keys.api_key_service import ApiKeyService
from app.models.models import User

router = APIRouter(dependencies=[Depends(require_roles("superadmin"))])


def _get_service(db: AsyncSession = Depends(get_db)) -> ApiKeyService:
    return ApiKeyService(db)


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.post("", response_model=ApiKeyCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: CreateApiKeyRequest,
    admin: RequireSuperAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        api_key, full_key = await service.create(
            body, created_by_user_id=admin.id
        )
        return ApiKeyCreatedResponse(
            id=api_key.id,
            name=api_key.name,
            description=api_key.description,
            key_prefix=api_key.key_prefix,
            is_active=api_key.is_active,
            created_by_user_id=api_key.created_by_user_id,
            last_used_at=api_key.last_used_at,
            created_at=api_key.created_at,
            updated_at=api_key.updated_at,
            full_key=full_key,
        )
    except DomainError as exc:
        _raise_domain(exc)


@router.get("", response_model=ApiKeyListResponse)
async def list_api_keys(
    _admin: RequireSuperAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    keys = await service.list()
    return ApiKeyListResponse(
        data=[
            ApiKeyResponse(
                id=k.id,
                name=k.name,
                description=k.description,
                key_prefix=k.key_prefix,
                is_active=k.is_active,
                created_by_user_id=k.created_by_user_id,
                last_used_at=k.last_used_at,
                created_at=k.created_at,
                updated_at=k.updated_at,
            )
            for k in keys
        ],
        total=len(keys),
    )


@router.get("/{api_key_id}", response_model=ApiKeyResponse)
async def get_api_key(
    api_key_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        api_key = await service.get_by_id(api_key_id)
        return ApiKeyResponse(
            id=api_key.id,
            name=api_key.name,
            description=api_key.description,
            key_prefix=api_key.key_prefix,
            is_active=api_key.is_active,
            created_by_user_id=api_key.created_by_user_id,
            last_used_at=api_key.last_used_at,
            created_at=api_key.created_at,
            updated_at=api_key.updated_at,
        )
    except DomainError as exc:
        _raise_domain(exc)


@router.patch("/{api_key_id}", response_model=ApiKeyResponse)
async def update_api_key(
    api_key_id: uuid.UUID,
    body: UpdateApiKeyRequest,
    _admin: RequireSuperAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        api_key = await service.update(api_key_id, body)
        return ApiKeyResponse(
            id=api_key.id,
            name=api_key.name,
            description=api_key.description,
            key_prefix=api_key.key_prefix,
            is_active=api_key.is_active,
            created_by_user_id=api_key.created_by_user_id,
            last_used_at=api_key.last_used_at,
            created_at=api_key.created_at,
            updated_at=api_key.updated_at,
        )
    except DomainError as exc:
        _raise_domain(exc)


@router.delete("/{api_key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    api_key_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        await service.revoke(api_key_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/{api_key_id}/rotate", response_model=ApiKeyCreatedResponse)
async def rotate_api_key(
    api_key_id: uuid.UUID,
    _admin: RequireSuperAdmin,
    service: ApiKeyService = Depends(_get_service),
):
    try:
        api_key, full_key = await service.rotate(api_key_id)
        return ApiKeyCreatedResponse(
            id=api_key.id,
            name=api_key.name,
            description=api_key.description,
            key_prefix=api_key.key_prefix,
            is_active=api_key.is_active,
            created_by_user_id=api_key.created_by_user_id,
            last_used_at=api_key.last_used_at,
            created_at=api_key.created_at,
            updated_at=api_key.updated_at,
            full_key=full_key,
        )
    except DomainError as exc:
        _raise_domain(exc)
