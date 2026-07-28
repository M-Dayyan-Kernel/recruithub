"""Tenant user and invite management."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.security import hash_password
from app.exceptions import BadRequestError, ConflictError, NotFoundError
from app.models.models import User
from app.repositories.tenant_invite_repository import TenantInviteRepository
from app.repositories.tenant_repository import TenantRepository
from app.repositories.user_repository import UserRepository
from app.schemas.schemas import (
    InviteCreateRequest,
    InviteListItem,
    InviteResponse,
    PaginatedResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from app.services.audit_service import AuditService
from app.services.email_service import send_org_invite_email
from app.services.tenant_service import TenantService

logger = logging.getLogger(__name__)


class UserManagementService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        user_repo: UserRepository | None = None,
        tenant_repo: TenantRepository | None = None,
        invite_repo: TenantInviteRepository | None = None,
        tenant_service: TenantService | None = None,
        audit_service: AuditService | None = None,
    ) -> None:
        self._session = session
        self._users = user_repo or UserRepository(session)
        self._tenants = tenant_repo or TenantRepository(session)
        self._invites = invite_repo or TenantInviteRepository(session)
        self._tenant_service = tenant_service or TenantService(session)
        self._audit = audit_service or AuditService(session)

    async def list_users(
        self, admin: User, *, offset: int, limit: int
    ) -> PaginatedResponse:
        items, total = await self._users.list_for_tenant(
            admin.tenant_id, offset=offset, limit=limit
        )
        return PaginatedResponse(
            items=[UserResponse.model_validate(u) for u in items],
            total=total,
            limit=limit,
            offset=offset,
        )

    async def create_user(self, body: UserCreate, admin: User) -> UserResponse:
        email = body.email.strip().lower()
        if await self._users.exists_by_email(email):
            raise ConflictError(public_message="A user with this email already exists")

        user = User(
            tenant_id=admin.tenant_id,
            email=email,
            full_name=body.full_name.strip(),
            hashed_password=await asyncio.to_thread(hash_password, body.password),
            role=body.role,
            is_active=True,
        )
        self._users.add(user)
        await self._users.flush()
        await self._audit.log_change(
            actor=admin,
            action="user.created",
            entity_type="user",
            entity_id=user.id,
            subject_label=user.email,
            feature="user",
            before=None,
            after={"email": user.email, "full_name": user.full_name, "role": user.role},
        )
        await self._session.commit()
        await self._users.refresh(user)
        logger.info(
            "%s created a new %s account",
            admin.full_name or "An admin",
            user.role.replace("_", " "),
        )
        return UserResponse.model_validate(user)

    async def list_invites(self, admin: User) -> list[InviteListItem]:
        invites = await self._invites.list_unaccepted_for_tenant(admin.tenant_id)
        now = datetime.now(timezone.utc)
        items: list[InviteListItem] = []
        for invite in invites:
            expires = invite.expires_at
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            items.append(
                InviteListItem(
                    id=invite.id,
                    email=invite.email,
                    role=invite.role,  # type: ignore[arg-type]
                    invite_url=self._invite_url(invite.token),
                    expires_at=invite.expires_at,
                    created_at=invite.created_at,
                    status="pending" if expires > now else "expired",
                )
            )
        return items

    async def revoke_invite(self, invite_id: uuid.UUID, admin: User) -> None:
        invite = await self._invites.get_by_id(invite_id)
        if invite is None or invite.tenant_id != admin.tenant_id:
            raise NotFoundError(public_message="Invite not found")
        if invite.accepted_at is not None:
            raise BadRequestError(public_message="Invite already accepted")

        label = invite.email
        await self._audit.log_change(
            actor=admin,
            action="user.invite_revoked",
            entity_type="invite",
            entity_id=invite.id,
            subject_label=label,
            feature="user",
            before={"email": label, "role": invite.role},
            after=None,
        )
        await self._invites.delete(invite)
        await self._session.commit()

    async def invite_user(self, body: InviteCreateRequest, admin: User) -> InviteResponse:
        email = body.email.strip().lower()
        if await self._users.exists_by_email(email):
            raise ConflictError(public_message="A user with this email already exists")

        now = datetime.now(timezone.utc)
        if await self._invites.has_active_pending(admin.tenant_id, email, now=now):
            raise ConflictError(
                public_message="An active invite already exists for this email",
            )

        invite = await self._tenant_service.create_invite(
            tenant_id=admin.tenant_id,
            email=email,
            role=body.role,
            invited_by=admin,
        )
        await self._audit.log_change(
            actor=admin,
            action="user.invited",
            entity_type="invite",
            entity_id=invite.id,
            subject_label=email,
            feature="user",
            before=None,
            after={"email": email, "role": body.role},
        )
        await self._session.commit()

        invite_url = self._invite_url(invite.token)
        tenant = await self._tenants.get_by_id(admin.tenant_id)
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

    async def update_user(
        self, user_id: uuid.UUID, body: UserUpdate, admin: User
    ) -> UserResponse:
        user = await self._users.get_by_id(user_id)
        if user is None or user.tenant_id != admin.tenant_id:
            raise NotFoundError(public_message="User not found")

        data = body.model_dump(exclude_unset=True)
        changes: dict = {}

        if "password" in data:
            password = data.pop("password")
            if password:
                user.hashed_password = await asyncio.to_thread(hash_password, password)
                changes["password"] = (None, "[redacted]")
        if "full_name" in data and data["full_name"] is not None:
            before = user.full_name
            user.full_name = data["full_name"].strip()
            changes["full_name"] = (before, user.full_name)
        if "role" in data and data["role"] is not None:
            if user.id == admin.id and data["role"] != "admin":
                raise BadRequestError(
                    public_message="Cannot change your own role away from admin",
                )
            before = user.role
            user.role = data["role"]
            changes["role"] = (before, user.role)
        if "is_active" in data and data["is_active"] is not None:
            if user.id == admin.id and data["is_active"] is False:
                raise BadRequestError(public_message="Cannot deactivate your own account")
            before = user.is_active
            user.is_active = data["is_active"]
            changes["is_active"] = (before, user.is_active)

        await self._audit.log_field_changes(
            actor=admin,
            action="user.updated",
            entity_type="user",
            entity_id=user.id,
            subject_label=user.email,
            changes=changes,
        )
        await self._session.commit()
        await self._users.refresh(user)
        return UserResponse.model_validate(user)

    async def delete_user(self, user_id: uuid.UUID, admin: User) -> None:
        user = await self._users.get_by_id(user_id)
        if user is None or user.tenant_id != admin.tenant_id:
            raise NotFoundError(public_message="User not found")
        if user.id == admin.id:
            raise BadRequestError(public_message="Cannot delete your own account")

        label = user.email
        await self._audit.log_change(
            actor=admin,
            action="user.deleted",
            entity_type="user",
            entity_id=user.id,
            subject_label=label,
            feature="user",
            before={"email": label, "role": user.role, "full_name": user.full_name},
            after=None,
        )
        await self._users.delete(user)
        await self._session.commit()

    @staticmethod
    def _invite_url(token: str) -> str:
        base = config.HR_APP_URL.rstrip("/")
        return f"{base}/accept-invite?token={token}"
