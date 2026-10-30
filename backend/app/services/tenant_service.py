"""Tenant creation, platform bootstrap, and invite helpers."""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_utils import run_sync
from app.core.constants import (
    INVITE_TTL_DAYS,
    ORG_NAME_TAKEN_CODE,
    ORG_NAME_TAKEN_MESSAGE,
    ORG_NAME_UNIQUE_INDEX,
    PLATFORM_TENANT_SLUG,
)
from app.core.security import hash_password
from app.core.tenancy import normalize_org_name
from app.exceptions import ConflictError
from app.models.models import Tenant, TenantInvite, User
from app.repositories.system_settings_repository import SystemSettingsRepository
from app.repositories.tenant_invite_repository import TenantInviteRepository
from app.repositories.tenant_repository import TenantRepository
from app.repositories.user_repository import UserRepository
from app.services.integrity_service import IntegrityService

logger = logging.getLogger(__name__)


class TenantService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        tenant_repo: TenantRepository | None = None,
        user_repo: UserRepository | None = None,
        settings_repo: SystemSettingsRepository | None = None,
        invite_repo: TenantInviteRepository | None = None,
        integrity_service: IntegrityService | None = None,
    ) -> None:
        self._session = session
        self._tenants = tenant_repo or TenantRepository(session)
        self._users = user_repo or UserRepository(session)
        self._settings = settings_repo or SystemSettingsRepository(session)
        self._invites = invite_repo or TenantInviteRepository(session)
        self._integrity = integrity_service or IntegrityService(session)

    async def ensure_platform_tenant(self) -> Tenant:
        tenant = await self._tenants.get_by_slug(PLATFORM_TENANT_SLUG)
        if tenant:
            return tenant
        tenant = Tenant(name="Platform", slug=PLATFORM_TENANT_SLUG, is_active=True)
        self._tenants.add(tenant)
        await self._tenants.flush()
        await self._settings.get_or_create_platform_settings(tenant.id)
        await self._tenants.flush()
        return tenant

    async def create_tenant_with_admin(
        self,
        *,
        organization_name: str,
        email: str,
        password: str,
        full_name: str,
        verification_status: str = "approved",
        is_active: bool | None = None,
        company_registration_number: str | None = None,
        gst_document_path: str | None = None,
        gst_document_filename: str | None = None,
    ) -> tuple[Tenant, User]:
        name = normalize_org_name(organization_name)
        # Slugs are auto-suffixed, so without this two orgs would silently share
        # a display name and differ only by "-2".
        if await self._tenants.name_exists(name):
            raise ConflictError(
                public_message=ORG_NAME_TAKEN_MESSAGE, error_code=ORG_NAME_TAKEN_CODE
            )
        slug = await self._tenants.ensure_unique_slug(name)
        active = is_active if is_active is not None else verification_status == "approved"
        tenant = Tenant(
            name=name,
            slug=slug,
            is_active=active,
            verification_status=verification_status,
            company_registration_number=(
                company_registration_number.strip() if company_registration_number else None
            ),
            gst_document_path=gst_document_path,
            gst_document_filename=gst_document_filename,
        )
        self._tenants.add(tenant)
        try:
            await self._tenants.flush()
        except IntegrityError as exc:
            # A concurrent request took the name between the check and the insert.
            if ORG_NAME_UNIQUE_INDEX not in str(exc.orig):
                raise
            await self._session.rollback()
            raise ConflictError(
                public_message=ORG_NAME_TAKEN_MESSAGE, error_code=ORG_NAME_TAKEN_CODE
            ) from exc
        logger.info(
            'Created organization "%s" with verification status %s',
            tenant.name,
            verification_status.replace("_", " "),
        )
        await self._settings.get_or_create(tenant.id, company_name=name)
        # Every organization starts with its own copy of the default blocklist.
        await self._integrity.seed_new_organization(tenant.id)
        hashed = await run_sync(hash_password, password)
        admin = User(
            tenant_id=tenant.id,
            email=email.strip().lower(),
            full_name=full_name.strip(),
            hashed_password=hashed,
            role="admin",
            is_active=True,
        )
        self._users.add(admin)
        await self._users.flush()
        return tenant, admin

    async def create_invite(
        self,
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
        self._invites.add(invite)
        await self._invites.flush()
        return invite

    async def get_valid_invite(self, token: str) -> TenantInvite | None:
        return await self._invites.get_valid_by_token(token)

    async def accept_invite(
        self,
        *,
        invite: TenantInvite,
        full_name: str,
        password: str,
    ) -> User:
        user = User(
            tenant_id=invite.tenant_id,
            email=invite.email.strip().lower(),
            full_name=full_name.strip(),
            hashed_password=await run_sync(hash_password, password),
            role=invite.role,
            is_active=True,
        )
        invite.accepted_at = datetime.now(timezone.utc)
        self._users.add(user)
        await self._users.flush()
        return user

    async def get_or_create_default_tenant(self) -> Tenant:
        tenant = await self._tenants.get_or_create_default()
        await self._settings.get_or_create(tenant.id)
        await self._tenants.flush()
        return tenant


# --- backward-compatible module shims ---------------------------------------
async def ensure_platform_tenant(db: AsyncSession) -> Tenant:
    return await TenantService(db).ensure_platform_tenant()


async def create_tenant_with_admin(db: AsyncSession, **kwargs) -> tuple[Tenant, User]:
    return await TenantService(db).create_tenant_with_admin(**kwargs)


async def create_invite(db: AsyncSession, **kwargs) -> TenantInvite:
    return await TenantService(db).create_invite(**kwargs)


async def get_valid_invite(db: AsyncSession, token: str) -> TenantInvite | None:
    return await TenantService(db).get_valid_invite(token)


async def get_or_create_default_tenant(db: AsyncSession) -> Tenant:
    return await TenantService(db).get_or_create_default_tenant()
