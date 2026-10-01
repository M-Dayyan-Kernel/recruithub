import uuid

from fastapi import APIRouter, Depends, status

from app.core.pagination import PaginationParams
from app.dependencies import RequireAdmin, get_user_management_service
from app.exceptions import DomainError
from app.schemas.schemas import (
    InviteCreateRequest,
    InviteListItem,
    InviteResponse,
    PaginatedResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from app.services.user_management_service import UserManagementService

router = APIRouter()


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.get("", response_model=PaginatedResponse)
async def list_users(
    admin: RequireAdmin,
    pagination: PaginationParams = Depends(),
    service: UserManagementService = Depends(get_user_management_service),
):
    return await service.list_users(
        admin, offset=pagination.offset, limit=pagination.limit
    )


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    admin: RequireAdmin,
    service: UserManagementService = Depends(get_user_management_service),
):
    try:
        return await service.create_user(body, admin)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/invites", response_model=list[InviteListItem])
async def list_invites(
    admin: RequireAdmin,
    service: UserManagementService = Depends(get_user_management_service),
):
    return await service.list_invites(admin)


@router.delete("/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: str,
    admin: RequireAdmin,
    service: UserManagementService = Depends(get_user_management_service),
):
    try:
        await service.revoke_invite(uuid.UUID(invite_id), admin)
    except (ValueError, DomainError) as exc:
        if isinstance(exc, DomainError):
            _raise_domain(exc)
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Invite not found") from exc


@router.post("/invites", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
async def invite_user(
    body: InviteCreateRequest,
    admin: RequireAdmin,
    service: UserManagementService = Depends(get_user_management_service),
):
    try:
        return await service.invite_user(body, admin)
    except DomainError as exc:
        _raise_domain(exc)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    body: UserUpdate,
    admin: RequireAdmin,
    service: UserManagementService = Depends(get_user_management_service),
):
    try:
        return await service.update_user(uuid.UUID(user_id), body, admin)
    except (ValueError, DomainError) as exc:
        if isinstance(exc, DomainError):
            _raise_domain(exc)
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="User not found") from exc


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    admin: RequireAdmin,
    service: UserManagementService = Depends(get_user_management_service),
):
    try:
        await service.delete_user(uuid.UUID(user_id), admin)
    except (ValueError, DomainError) as exc:
        if isinstance(exc, DomainError):
            _raise_domain(exc)
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="User not found") from exc
