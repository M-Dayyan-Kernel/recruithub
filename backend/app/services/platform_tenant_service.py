"""Superadmin platform tenant management."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import DEFAULT_TENANT_SLUG, PLATFORM_TENANT_SLUG
from app.exceptions import BadRequestError, ConflictError, NotFoundError
from app.models.models import Tenant, User
from app.repositories.refresh_token_repository import RefreshTokenRepository
from app.repositories.tenant_repository import TenantRepository
from app.repositories.user_repository import UserRepository
from app.schemas.schemas import (
    TenantCreateRequest,
    TenantListItem,
    TenantResponse,
    TenantUpdateRequest,
    UserResponse,
)
from app.services.audit_service import AuditService
from app.services.gst_document_service import GstDocumentService
from app.services.tenant_service import TenantService

logger = logging.getLogger(__name__)


class PlatformTenantService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        tenant_repo: TenantRepository | None = None,
        user_repo: UserRepository | None = None,
        tenant_service: TenantService | None = None,
        audit_service: AuditService | None = None,
        gst_documents: GstDocumentService | None = None,
        refresh_token_repo: RefreshTokenRepository | None = None,
    ) -> None:
        self._session = session
        self._tenants = tenant_repo or TenantRepository(session)
        self._users = user_repo or UserRepository(session)
        self._tenant_service = tenant_service or TenantService(session)
        self._audit = audit_service or AuditService(session)
        self._gst = gst_documents or GstDocumentService()
        self._refresh_tokens = refresh_token_repo or RefreshTokenRepository(session)

    async def _revoke_tenant_sessions(self, tenant: Tenant) -> None:
        """Kill refresh tokens so a disabled org cannot extend live sessions.

        Access tokens already in the wild stay valid until they expire, but
        every request they make is rejected by TenantAccessPolicy.
        """
        revoked = await self._refresh_tokens.revoke_all_for_tenant(tenant.id)
        if revoked:
            logger.info(
                "Revoked %s refresh token(s) after disabling organization %s",
                revoked,
                tenant.name,
            )

    async def list_tenants(self) -> list[TenantListItem]:
        users_by_tenant = await self._users.count_by_tenant_excluding_superadmin()
        jobs_by_tenant = await self._tenants.job_counts_by_tenant()
        admin_rows = await self._users.list_admins_by_tenant()
        admin_by_tenant: dict = {}
        for tenant_id, email, full_name in admin_rows:
            if tenant_id not in admin_by_tenant:
                admin_by_tenant[tenant_id] = (email, full_name)

        tenants = await self._tenants.list_customer_tenants()
        items: list[TenantListItem] = []
        for tenant in tenants:
            admin = admin_by_tenant.get(tenant.id)
            items.append(self._tenant_list_item(
                tenant,
                users_by_tenant.get(tenant.id, 0),
                jobs_by_tenant.get(tenant.id, 0),
                admin_email=admin[0] if admin else None,
                admin_full_name=admin[1] if admin else None,
            ))
        return items

    async def create_tenant(self, body: TenantCreateRequest, admin: User) -> TenantResponse:
        email = body.admin_email.strip().lower()
        if await self._users.exists_by_email(email):
            raise ConflictError(public_message="A user with this email already exists")

        tenant, org_admin = await self._tenant_service.create_tenant_with_admin(
            organization_name=body.name,
            email=email,
            password=body.admin_password,
            full_name=body.admin_full_name,
            verification_status="approved",
            is_active=True,
        )
        await self._audit.log_change(
            actor=admin,
            action="tenant.created",
            entity_type="tenant",
            entity_id=tenant.id,
            subject_label=tenant.name,
            feature="platform",
            before=None,
            after={"name": tenant.name, "slug": tenant.slug, "admin_email": org_admin.email},
        )
        await self._session.commit()
        await self._tenants.refresh(tenant)
        return TenantResponse.model_validate(tenant)

    async def update_tenant(
        self, tenant_id: uuid.UUID, body: TenantUpdateRequest, admin: User
    ) -> TenantResponse:
        tenant = await self._get_customer_tenant(tenant_id)
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
                raise BadRequestError(
                    public_message="Approve the organization before activating it",
                )
            if not data["is_active"] and tenant.slug == DEFAULT_TENANT_SLUG:
                raise BadRequestError(
                    public_message="The default organization cannot be deactivated",
                )
            tenant.is_active = data["is_active"]
            if not tenant.is_active and before["is_active"]:
                await self._revoke_tenant_sessions(tenant)

        await self._audit.log_change(
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
        await self._session.commit()
        await self._tenants.refresh(tenant)
        return TenantResponse.model_validate(tenant)

    async def approve_tenant(self, tenant_id: uuid.UUID, admin: User) -> TenantResponse:
        tenant = await self._get_customer_tenant(tenant_id)
        before = {
            "verification_status": tenant.verification_status,
            "is_active": tenant.is_active,
        }
        tenant.verification_status = "approved"
        tenant.is_active = True
        await self._audit.log_change(
            actor=admin,
            action="tenant.approved",
            entity_type="tenant",
            entity_id=tenant.id,
            subject_label=tenant.name,
            feature="platform",
            before=before,
            after={"verification_status": "approved", "is_active": True},
        )
        await self._session.commit()
        await self._tenants.refresh(tenant)
        return TenantResponse.model_validate(tenant)

    async def reject_tenant(self, tenant_id: uuid.UUID, admin: User) -> TenantResponse:
        tenant = await self._get_customer_tenant(tenant_id)
        before = {
            "verification_status": tenant.verification_status,
            "is_active": tenant.is_active,
        }
        tenant.verification_status = "rejected"
        tenant.is_active = False
        await self._revoke_tenant_sessions(tenant)
        await self._audit.log_change(
            actor=admin,
            action="tenant.rejected",
            entity_type="tenant",
            entity_id=tenant.id,
            subject_label=tenant.name,
            feature="platform",
            before=before,
            after={"verification_status": "rejected", "is_active": False},
        )
        await self._session.commit()
        await self._tenants.refresh(tenant)
        return TenantResponse.model_validate(tenant)

    async def download_gst_document(self, tenant_id: uuid.UUID):
        tenant = await self._get_customer_tenant(tenant_id)
        if not tenant.gst_document_path:
            raise NotFoundError(public_message="No GST document uploaded")

        filename = tenant.gst_document_filename or "gst-document.pdf"
        from app.services.s3_service import is_s3_object_key

        if is_s3_object_key(tenant.gst_document_path):
            try:
                data = await self._gst.read_document_bytes(tenant.gst_document_path)
            except Exception as exc:
                logger.warning("Failed to download GST from S3 for tenant %s: %s", tenant_id, exc)
                raise NotFoundError(
                    public_message="GST document file missing in storage",
                ) from exc
            return Response(
                content=data,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        path = Path(tenant.gst_document_path)
        if not path.is_file():
            raise NotFoundError(public_message="GST document file missing on disk")
        return FileResponse(path, media_type="application/pdf", filename=filename)

    async def list_tenant_users(self, tenant_id: uuid.UUID) -> list[UserResponse]:
        await self._get_customer_tenant(tenant_id)
        users = await self._users.list_for_tenant_unpaginated(tenant_id)
        return [UserResponse.model_validate(u) for u in users]

    async def delete_tenant(self, tenant_id: uuid.UUID, admin: User) -> None:
        tenant = await self._get_customer_tenant(tenant_id)
        label = tenant.name
        slug = tenant.slug
        doc_path = tenant.gst_document_path
        await self._audit.log_change(
            actor=admin,
            action="tenant.deleted",
            entity_type="tenant",
            entity_id=tenant.id,
            subject_label=label,
            feature="platform",
            before={"name": label, "slug": slug, "is_active": tenant.is_active},
            after=None,
        )
        await self._tenants.delete_settings_for_tenant(tenant_id)
        await self._tenants.delete(tenant)
        await self._session.commit()

        if doc_path:
            try:
                await self._gst.delete_document(doc_path)
            except OSError as exc:
                logger.warning(
                    "Tenant %s deleted but GST doc cleanup failed: %s", tenant_id, exc
                )

    async def _get_customer_tenant(self, tenant_id: uuid.UUID) -> Tenant:
        tenant = await self._tenants.get_by_id(tenant_id)
        if tenant is None or tenant.slug == PLATFORM_TENANT_SLUG:
            raise NotFoundError(public_message="Organization not found")
        return tenant

    @staticmethod
    def _tenant_list_item(
        tenant: Tenant,
        user_count: int,
        job_count: int,
        *,
        admin_email: str | None = None,
        admin_full_name: str | None = None,
    ) -> TenantListItem:
        return TenantListItem(
            id=tenant.id,
            name=tenant.name,
            slug=tenant.slug,
            is_active=tenant.is_active,
            verification_status=tenant.verification_status,  # type: ignore[arg-type]
            company_registration_number=tenant.company_registration_number,
            gst_document_filename=tenant.gst_document_filename,
            has_gst_document=bool(tenant.gst_document_path),
            admin_email=admin_email,
            admin_full_name=admin_full_name,
            created_at=tenant.created_at,
            user_count=user_count,
            job_count=job_count,
        )
