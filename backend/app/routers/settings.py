"""
System settings API — per-tenant geography and email templates.
"""

from fastapi import APIRouter, Depends, status

from app.dependencies import (
    RequireAdmin,
    RequireAdminOrHr,
    admin_roles,
    get_system_settings_service,
    hr_roles,
)
from app.exceptions import DomainError
from app.schemas.schemas import (
    EmailTemplatePreviewRequest,
    EmailTemplatePreviewResponse,
    EmailTemplateTestRequest,
    EmailTemplateUpdate,
    EmailTemplatesResponse,
    SystemSettingsResponse,
    SystemSettingsUpdate,
)
from app.services.system_settings_service import SystemSettingsService

_hr_auth = Depends(hr_roles)
_admin_auth = Depends(admin_roles)

router = APIRouter()


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.get(
    "/settings",
    response_model=SystemSettingsResponse,
    dependencies=[_hr_auth],
)
async def get_settings(
    user: RequireAdminOrHr,
    service: SystemSettingsService = Depends(get_system_settings_service),
):
    return await service.get_settings(user.tenant_id)


@router.patch(
    "/settings",
    response_model=SystemSettingsResponse,
    dependencies=[_admin_auth],
)
async def update_settings(
    payload: SystemSettingsUpdate,
    admin: RequireAdmin,
    service: SystemSettingsService = Depends(get_system_settings_service),
):
    try:
        return await service.update_settings(admin, payload)
    except DomainError as exc:
        _raise_domain(exc)


@router.get(
    "/settings/email-templates",
    response_model=EmailTemplatesResponse,
    dependencies=[_admin_auth],
)
async def get_email_templates(
    admin: RequireAdmin,
    service: SystemSettingsService = Depends(get_system_settings_service),
):
    return await service.get_email_templates(admin.tenant_id)


@router.patch(
    "/settings/email-templates/{template_id}",
    response_model=EmailTemplatesResponse,
    dependencies=[_admin_auth],
)
async def update_email_template(
    template_id: str,
    payload: EmailTemplateUpdate,
    admin: RequireAdmin,
    service: SystemSettingsService = Depends(get_system_settings_service),
):
    try:
        return await service.update_email_template(admin, template_id, payload)
    except DomainError as exc:
        _raise_domain(exc)


@router.post(
    "/settings/email-templates/{template_id}/restore",
    response_model=EmailTemplatesResponse,
    dependencies=[_admin_auth],
)
async def restore_email_template(
    template_id: str,
    admin: RequireAdmin,
    service: SystemSettingsService = Depends(get_system_settings_service),
):
    try:
        return await service.restore_email_template(admin, template_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.post(
    "/settings/email-templates/{template_id}/preview",
    response_model=EmailTemplatePreviewResponse,
    dependencies=[_admin_auth],
)
async def preview_email_template(
    template_id: str,
    payload: EmailTemplatePreviewRequest,
    admin: RequireAdmin,
    service: SystemSettingsService = Depends(get_system_settings_service),
):
    try:
        return await service.preview_email_template(admin.tenant_id, template_id, payload)
    except DomainError as exc:
        _raise_domain(exc)


@router.post(
    "/settings/email-templates/{template_id}/test",
    status_code=status.HTTP_200_OK,
    dependencies=[_admin_auth],
)
async def test_email_template(
    template_id: str,
    payload: EmailTemplateTestRequest,
    admin: RequireAdmin,
    service: SystemSettingsService = Depends(get_system_settings_service),
):
    try:
        return await service.test_email_template(admin, template_id, payload)
    except DomainError as exc:
        _raise_domain(exc)
