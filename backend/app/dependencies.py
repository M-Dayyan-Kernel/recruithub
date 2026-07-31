"""FastAPI dependency injection for auth and Part 1 services."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients import (
    GmailClient,
    LiveKitClient,
    OpenAIClient,
    S3Client,
    VapiClient,
    get_gmail_client,
    get_livekit_client,
    get_openai_client,
    get_s3_client,
    get_vapi_client,
)
from app.core.constants import PLATFORM_TENANT_SLUG
from app.core.database import get_db
from app.exceptions import DomainError
from app.models.models import User
from app.services.audit_service import AuditService
from app.services.auth_service import AuthService
from app.services.authentication_context_service import AuthenticationContextService
from app.services.platform_tenant_service import PlatformTenantService
from app.services.system_settings_service import SystemSettingsService
from app.services.candidate_service import CandidateService
from app.services.job_description_parse_service import JobDescriptionParseService
from app.services.job_service import JobService
from app.services.resume_upload_service import ResumeUploadService
from app.services.shortlist_service import ShortlistService
from app.services.shortlist_trigger_service import ShortlistTriggerService
from app.services.screening_service import ScreeningService
from app.services.screening_trigger_service import ScreeningTriggerService
from app.services.screening_webhook_service import ScreeningWebhookService
from app.services.interview_hr_service import InterviewHrService
from app.services.interview_public_service import InterviewPublicService
from app.services.interview_webhook_service import InterviewWebhookService
from app.services.interview_report_service import InterviewReportService
from app.services.user_management_service import UserManagementService

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials

    # API key auth — tokens starting with rhub_ bypass JWT resolution
    if token.startswith("rhub_"):
        from app.modules.api_keys.api_key_service import ApiKeyService

        api_key = await ApiKeyService.validate_api_key(token, db)
        if api_key is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or revoked API key",
                headers={"WWW-Authenticate": "Bearer"},
            )
        now = datetime.now(timezone.utc)
        # Tenant-scoped keys authenticate as org admins (their data is scoped to
        # the key's tenant via actor.tenant_id); legacy global keys stay superadmin.
        # id=None keeps nullable FKs (api_keys.created_by_user_id, audit_logs.actor_user_id)
        # valid — a fabricated UUID would violate them.
        is_tenant_scoped = api_key.tenant_id is not None
        return User(
            id=None,
            tenant_id=api_key.tenant_id,
            email=api_key.name,
            full_name=api_key.name,
            hashed_password="",
            role="admin" if is_tenant_scoped else "superadmin",
            is_active=True,
            created_at=now,
            updated_at=now,
        )

    try:
        return await AuthenticationContextService(db).resolve_user_from_token(token)
    except DomainError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=exc.public_message,
            headers=exc.headers,
        ) from exc


def require_roles(*allowed_roles: str) -> Callable:
    async def _checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _checker


RequireAdminOrHr = Annotated[User, Depends(require_roles("admin", "hr", "superadmin"))]
RequireAdmin = Annotated[User, Depends(require_roles("admin", "superadmin"))]
RequireSuperAdmin = Annotated[User, Depends(require_roles("superadmin"))]

hr_roles = require_roles("admin", "hr", "superadmin")
admin_roles = require_roles("admin", "superadmin")


def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    return AuthService(db)


def get_platform_tenant_service(db: AsyncSession = Depends(get_db)) -> PlatformTenantService:
    return PlatformTenantService(db)


def get_user_management_service(db: AsyncSession = Depends(get_db)) -> UserManagementService:
    return UserManagementService(db)


def get_system_settings_service(db: AsyncSession = Depends(get_db)) -> SystemSettingsService:
    return SystemSettingsService(db)


def get_audit_service(db: AsyncSession = Depends(get_db)) -> AuditService:
    return AuditService(db)


def get_job_service(db: AsyncSession = Depends(get_db)) -> JobService:
    return JobService(db)


def get_job_description_parse_service(
    db: AsyncSession = Depends(get_db),
) -> JobDescriptionParseService:
    return JobDescriptionParseService(db)


def get_resume_upload_service(db: AsyncSession = Depends(get_db)) -> ResumeUploadService:
    return ResumeUploadService(db)


def get_candidate_service(db: AsyncSession = Depends(get_db)) -> CandidateService:
    return CandidateService(db)


def get_shortlist_trigger_service(
    db: AsyncSession = Depends(get_db),
) -> ShortlistTriggerService:
    return ShortlistTriggerService(db)


def get_shortlist_service(db: AsyncSession = Depends(get_db)) -> ShortlistService:
    return ShortlistService(db)


def get_screening_trigger_service(
    db: AsyncSession = Depends(get_db),
) -> ScreeningTriggerService:
    return ScreeningTriggerService(db)


def get_screening_service(db: AsyncSession = Depends(get_db)) -> ScreeningService:
    return ScreeningService(db)


def get_screening_webhook_service(
    db: AsyncSession = Depends(get_db),
) -> ScreeningWebhookService:
    return ScreeningWebhookService(db)


def get_interview_hr_service(db: AsyncSession = Depends(get_db)) -> InterviewHrService:
    return InterviewHrService(db)


def get_interview_public_service(
    db: AsyncSession = Depends(get_db),
) -> InterviewPublicService:
    return InterviewPublicService(db)


def get_interview_webhook_service(
    db: AsyncSession = Depends(get_db),
) -> InterviewWebhookService:
    return InterviewWebhookService(db)


def get_interview_report_service(
    db: AsyncSession = Depends(get_db),
) -> InterviewReportService:
    return InterviewReportService(db)


def get_openai_client_dep() -> OpenAIClient:
    return get_openai_client()


def get_vapi_client_dep() -> VapiClient:
    return get_vapi_client()


def get_livekit_client_dep() -> LiveKitClient:
    return get_livekit_client()


def get_s3_client_dep() -> S3Client:
    return get_s3_client()


def get_gmail_client_dep() -> GmailClient:
    return get_gmail_client()
