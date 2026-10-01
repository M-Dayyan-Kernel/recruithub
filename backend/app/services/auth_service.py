"""Authentication, signup, invites, and token management."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from fastapi import Request, UploadFile
from pydantic import EmailStr, TypeAdapter, ValidationError as PydanticValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_utils import run_sync
from app.core.config_loader import config
from app.core.constants import PLATFORM_TENANT_SLUG
from app.core.rate_limit import (
    check_login_lockout,
    clear_login_failures,
    enforce_rate_limit,
    record_login_failure,
)
from app.core.security import create_access_token, verify_password
from app.exceptions import (
    AuthenticationError,
    AuthorizationError,
    BadRequestError,
    ConflictError,
    NotFoundError,
)
from app.models.models import Tenant, User
from app.repositories.tenant_repository import TenantRepository
from app.repositories.user_repository import UserRepository
from app.schemas.schemas import (
    AcceptInviteRequest,
    InvitePublicResponse,
    LoginRequest,
    MfaVerifyRequest,
    RefreshTokenRequest,
    SignupPendingResponse,
    SwitchTenantRequest,
    TokenResponse,
    UserResponse,
    validate_password_strength,
)
from app.services.gst_document_service import GstDocumentService
from app.services.mfa_service import MfaService
from app.services.refresh_token_service import RefreshTokenService
from app.services.tenant_access_policy import TenantAccessPolicy
from app.services.tenant_service import TenantService

logger = logging.getLogger(__name__)
_EMAIL_ADAPTER = TypeAdapter(EmailStr)


class AuthService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        user_repo: UserRepository | None = None,
        tenant_repo: TenantRepository | None = None,
        tenant_service: TenantService | None = None,
        refresh_tokens: RefreshTokenService | None = None,
        mfa_service: MfaService | None = None,
        gst_documents: GstDocumentService | None = None,
        access_policy: TenantAccessPolicy | None = None,
    ) -> None:
        self._session = session
        self._users = user_repo or UserRepository(session)
        self._tenants = tenant_repo or TenantRepository(session)
        self._tenant_service = tenant_service or TenantService(session)
        self._refresh_tokens = refresh_tokens or RefreshTokenService(session)
        self._mfa = mfa_service or MfaService(session)
        self._gst = gst_documents or GstDocumentService()
        self._access_policy = access_policy or TenantAccessPolicy()

    async def signup(
        self,
        request: Request,
        *,
        organization_name: str,
        email: str,
        password: str,
        full_name: str,
        company_registration_number: str | None,
        gst_document: UploadFile,
    ) -> SignupPendingResponse:
        await enforce_rate_limit(
            request,
            scope="auth:signup",
            limit=int(config.AUTH_RATE_LIMIT_PER_MINUTE),
        )
        org = organization_name.strip()
        if not org:
            raise BadRequestError(public_message="Organization name is required")
        full = full_name.strip()
        if not full:
            raise BadRequestError(public_message="Full name is required")
        if len(password) < 12:
            raise BadRequestError(public_message="Password must be at least 12 characters")
        try:
            validate_password_strength(password)
        except ValueError as exc:
            raise BadRequestError(public_message=str(exc)) from exc

        email_norm = self._parse_email_or_400(email)
        if await self._users.exists_by_email(email_norm):
            raise ConflictError(public_message="A user with this email already exists")

        pdf_bytes, original_name = await self._gst.read_and_validate_pdf(gst_document)
        tenant, admin = await self._tenant_service.create_tenant_with_admin(
            organization_name=org,
            email=email_norm,
            password=password,
            full_name=full,
            verification_status="pending",
            is_active=False,
            company_registration_number=company_registration_number,
        )
        tenant.gst_document_path = await run_sync(self._gst.persist, tenant.id, pdf_bytes)
        tenant.gst_document_filename = original_name
        await self._session.commit()

        return SignupPendingResponse(
            message=(
                "Organization submitted for verification. "
                "You can sign in after a platform admin approves your GST document."
            ),
            organization_name=tenant.name,
            email=admin.email,
            verification_status="pending",
        )

    async def login(self, body: LoginRequest, request: Request) -> TokenResponse:
        await enforce_rate_limit(
            request,
            scope="auth:login",
            limit=int(config.AUTH_RATE_LIMIT_PER_MINUTE),
        )
        email = body.email.strip().lower()
        await check_login_lockout(request, email)
        user = await self._users.get_by_email(email, load_tenant=True)
        password_ok = False
        if user is not None:
            password_ok = await asyncio.to_thread(
                verify_password, body.password, user.hashed_password
            )
        if user is None or not password_ok:
            await record_login_failure(request, email)
            logger.warning("Sign-in failed because the email or password was wrong")
            raise AuthenticationError(public_message="Invalid email or password")
        if not user.is_active:
            logger.warning("Sign-in blocked because the account is inactive")
            raise AuthorizationError(public_message="User account is inactive")
        if user.role != "superadmin":
            self._access_policy.assert_can_access(user.tenant)

        await clear_login_failures(request, email)
        refresh_raw = await self._refresh_tokens.issue(user)
        await self._session.commit()
        logger.info(
            "%s signed in successfully as %s",
            user.full_name or "A user",
            user.role.replace("_", " "),
        )
        return self._issue_token(
            user,
            tenant_name=user.tenant.name if user.tenant else None,
            refresh_token=refresh_raw,
        )

    def me(self, current_user: User) -> UserResponse:
        return self._user_response(current_user)

    async def switch_tenant(self, body: SwitchTenantRequest, admin: User) -> TokenResponse:
        tenant = await self._tenants.get_by_id(body.tenant_id)
        if tenant is None:
            raise NotFoundError(public_message="Organization not found")
        if tenant.slug == PLATFORM_TENANT_SLUG:
            raise BadRequestError(public_message="Cannot switch into the platform tenant")
        self._access_policy.assert_can_switch_to(tenant)

        home_id = getattr(admin, "home_tenant_id", None) or admin.tenant_id
        admin.home_tenant_id = home_id  # type: ignore[attr-defined]
        return self._issue_token(
            admin,
            tenant_name=tenant.name,
            active_tenant_id=str(tenant.id),
            active_tenant_name=tenant.name,
        )

    async def clear_tenant_switch(self, admin: User) -> TokenResponse:
        home_id = getattr(admin, "home_tenant_id", None) or admin.tenant_id
        tenant = await self._tenants.get_by_id(home_id)
        admin.home_tenant_id = home_id  # type: ignore[attr-defined]
        admin.tenant_id = home_id
        return self._issue_token(
            admin,
            tenant_name=tenant.name if tenant else "Platform",
        )

    async def get_invite_public(self, token: str, request: Request) -> InvitePublicResponse:
        await enforce_rate_limit(request, scope="auth:invite_lookup", limit=60)
        invite = await self._tenant_service.get_valid_invite(token)
        if invite is None:
            raise NotFoundError(public_message="Invite not found or expired")
        tenant = await self._tenants.get_by_id(invite.tenant_id)
        return InvitePublicResponse(
            email=invite.email,
            role=invite.role,  # type: ignore[arg-type]
            organization_name=tenant.name if tenant else "Organization",
            expires_at=invite.expires_at,
        )

    async def accept_invite(
        self, body: AcceptInviteRequest, request: Request
    ) -> TokenResponse:
        await enforce_rate_limit(
            request,
            scope="auth:accept_invite",
            limit=int(config.AUTH_RATE_LIMIT_PER_MINUTE),
        )
        invite = await self._tenant_service.get_valid_invite(body.token.strip())
        if invite is None:
            raise NotFoundError(public_message="Invite not found or expired")

        tenant = await self._tenants.get_by_id(invite.tenant_id)
        self._access_policy.assert_can_access(tenant)

        if await self._users.exists_by_email(invite.email):
            raise ConflictError(public_message="A user with this email already exists")

        user = await self._tenant_service.accept_invite(
            invite=invite,
            full_name=body.full_name,
            password=body.password,
        )
        await self._session.commit()
        await self._users.refresh(user)
        refresh_raw = await self._refresh_tokens.issue(user)
        await self._session.commit()
        return self._issue_token(
            user,
            tenant_name=tenant.name if tenant else None,
            refresh_token=refresh_raw,
        )

    async def refresh(self, body: RefreshTokenRequest) -> TokenResponse:
        rotated = await self._refresh_tokens.rotate(body.refresh_token)
        if rotated is None:
            raise AuthenticationError(public_message="Invalid or expired refresh token")
        user, new_refresh = rotated
        await self._session.commit()
        return self._issue_token(
            user,
            tenant_name=user.tenant.name if user.tenant else None,
            refresh_token=new_refresh,
        )

    async def logout(self, body: RefreshTokenRequest) -> None:
        await self._refresh_tokens.revoke(body.refresh_token)
        await self._session.commit()

    async def mfa_setup(self, current_user: User):
        return await self._mfa.setup(current_user)

    async def mfa_verify(self, current_user: User, body: MfaVerifyRequest) -> TokenResponse:
        await self._mfa.verify_and_enable(current_user, body.code)
        refresh_raw = await self._refresh_tokens.issue(current_user)
        await self._session.commit()
        return self._issue_token(current_user, refresh_token=refresh_raw)

    @staticmethod
    def _parse_email_or_400(raw: str) -> str:
        try:
            return str(_EMAIL_ADAPTER.validate_python((raw or "").strip().lower()))
        except PydanticValidationError:
            raise BadRequestError(
                public_message="Enter a valid email address (for example, you@company.com)",
            ) from None

    @staticmethod
    def _user_response(user: User, tenant_name: str | None = None) -> UserResponse:
        data = UserResponse.model_validate(user)
        data.tenant_name = tenant_name or getattr(user, "active_tenant_name", None) or (
            user.tenant.name if getattr(user, "tenant", None) else None
        )
        data.home_tenant_id = getattr(user, "home_tenant_id", None) or user.tenant_id
        data.active_tenant_id = getattr(user, "active_tenant_id", None) or user.tenant_id
        data.active_tenant_name = getattr(user, "active_tenant_name", None) or data.tenant_name
        return data

    @staticmethod
    def _issue_token(
        user: User,
        *,
        tenant_name: str | None = None,
        active_tenant_id: str | None = None,
        active_tenant_name: str | None = None,
        refresh_token: str | None = None,
    ) -> TokenResponse:
        home_tenant_id = getattr(user, "home_tenant_id", None) or user.tenant_id
        claims = {
            "role": user.role,
            "email": user.email,
            "tenant_id": str(home_tenant_id),
        }
        if active_tenant_id and user.role == "superadmin":
            claims["active_tenant_id"] = active_tenant_id

        if active_tenant_id and user.role == "superadmin":
            user.tenant_id = UUID(active_tenant_id)
            user.active_tenant_id = UUID(active_tenant_id)  # type: ignore[attr-defined]
            user.active_tenant_name = active_tenant_name  # type: ignore[attr-defined]
            user.home_tenant_id = home_tenant_id  # type: ignore[attr-defined]

        token = create_access_token(subject=str(user.id), extra_claims=claims)
        return TokenResponse(
            access_token=token,
            refresh_token=refresh_token,
            user=AuthService._user_response(user, tenant_name=active_tenant_name or tenant_name),
        )
