"""
System settings API — per-tenant geography and email templates.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import RequireAdmin, RequireAdminOrHr, admin_roles, hr_roles
from app.models.models import SystemSettings
from app.schemas.schemas import (
    SystemSettingsResponse,
    SystemSettingsUpdate,
    EmailTemplatesResponse,
    EmailTemplateEntry,
    EmailTemplateUpdate,
    EmailTemplatePreviewRequest,
    EmailTemplatePreviewResponse,
    EmailTemplateTestRequest,
)
from app.services.audit_service import log_change, log_field_changes
from app.services.settings_service import (
    invalidate_settings_cache,
    normalize_max_retries,
    normalize_retry_delay_seconds,
)

_hr_auth = Depends(hr_roles)
_admin_auth = Depends(admin_roles)

router = APIRouter()


async def _get_or_create_settings(db: AsyncSession, tenant_id) -> SystemSettings:
    result = await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if row:
        return row

    row = SystemSettings(
        tenant_id=tenant_id,
        allowed_phone_regions=["IN"],
        enforce_phone_geography=True,
        screening_enabled=True,
        screening_max_retries=3,
        screening_retry_delay_seconds=1800,
        company_name="Webknot Technologies",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get(
    "/settings",
    response_model=SystemSettingsResponse,
    dependencies=[_hr_auth],
)
async def get_settings(
    user: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Return tenant settings (geography, etc.). Readable by admin and HR."""
    return await _get_or_create_settings(db, user.tenant_id)


@router.patch(
    "/settings",
    response_model=SystemSettingsResponse,
    dependencies=[_admin_auth],
)
async def update_settings(
    payload: SystemSettingsUpdate,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Update tenant settings. Admin only."""
    row = await _get_or_create_settings(db, admin.tenant_id)
    data = payload.model_dump(exclude_unset=True)
    changes: dict = {}

    if "allowed_phone_regions" in data and data["allowed_phone_regions"] is not None:
        if not data["allowed_phone_regions"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="allowed_phone_regions must contain at least one region",
            )
        changes["allowed_phone_regions"] = (
            list(row.allowed_phone_regions or []),
            list(data["allowed_phone_regions"]),
        )
        row.allowed_phone_regions = data["allowed_phone_regions"]

    if "enforce_phone_geography" in data and data["enforce_phone_geography"] is not None:
        changes["enforce_phone_geography"] = (
            row.enforce_phone_geography,
            data["enforce_phone_geography"],
        )
        row.enforce_phone_geography = data["enforce_phone_geography"]

    if "screening_enabled" in data and data["screening_enabled"] is not None:
        changes["screening_enabled"] = (row.screening_enabled, data["screening_enabled"])
        row.screening_enabled = data["screening_enabled"]

    if "screening_max_retries" in data and data["screening_max_retries"] is not None:
        try:
            new_val = normalize_max_retries(data["screening_max_retries"])
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        changes["screening_max_retries"] = (row.screening_max_retries, new_val)
        row.screening_max_retries = new_val

    if (
        "screening_retry_delay_seconds" in data
        and data["screening_retry_delay_seconds"] is not None
    ):
        try:
            new_val = normalize_retry_delay_seconds(
                data["screening_retry_delay_seconds"]
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        changes["screening_retry_delay_seconds"] = (
            row.screening_retry_delay_seconds,
            new_val,
        )
        row.screening_retry_delay_seconds = new_val

    if "company_name" in data and data["company_name"] is not None:
        new_name = str(data["company_name"]).strip()
        if not new_name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="company_name cannot be empty",
            )
        if len(new_name) > 255:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="company_name must be at most 255 characters",
            )
        changes["company_name"] = (row.company_name, new_name)
        row.company_name = new_name

    await log_field_changes(
        db,
        actor=admin,
        action="settings.updated",
        entity_type="settings",
        entity_id=None,
        subject_label="System settings",
        changes=changes,
    )
    await db.commit()
    await db.refresh(row)
    invalidate_settings_cache(admin.tenant_id)
    return row


async def _email_templates_response(db: AsyncSession, tenant_id) -> EmailTemplatesResponse:
    from app.services.email_template_service import (
        COMMON_PLACEHOLDERS,
        REQUIRED_PLACEHOLDERS,
        get_company_name,
        get_merged_templates,
    )

    merged = await get_merged_templates(db, tenant_id)
    company_name = await get_company_name(db, tenant_id)
    templates = {
        tid: EmailTemplateEntry(
            subject=entry["subject"],
            body_html=entry["body_html"],
            version=entry.get("version", 1),
            updated_at=entry.get("updated_at"),
        )
        for tid, entry in merged.items()
    }
    return EmailTemplatesResponse(
        templates=templates,
        required_placeholders={k: list(v) for k, v in REQUIRED_PLACEHOLDERS.items()},
        common_placeholders=list(COMMON_PLACEHOLDERS),
        company_name=company_name,
    )


@router.get(
    "/settings/email-templates",
    response_model=EmailTemplatesResponse,
    dependencies=[_admin_auth],
)
async def get_email_templates(
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    return await _email_templates_response(db, admin.tenant_id)


@router.patch(
    "/settings/email-templates/{template_id}",
    response_model=EmailTemplatesResponse,
    dependencies=[_admin_auth],
)
async def update_email_template(
    template_id: str,
    payload: EmailTemplateUpdate,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    from app.services.email_template_service import (
        save_template,
        get_merged_templates,
    )

    before_merged = await get_merged_templates(db, admin.tenant_id)
    before_entry = before_merged.get(template_id) or {}

    try:
        await save_template(
            db, admin.tenant_id, template_id, payload.subject, payload.body_html
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await log_change(
        db,
        actor=admin,
        action="settings.email_template_updated",
        entity_type="settings",
        entity_id=None,
        subject_label=f"Email template: {template_id}",
        feature="email_templates",
        before={
            "subject": before_entry.get("subject"),
            "version": before_entry.get("version"),
        },
        after={"subject": payload.subject, "template_id": template_id},
    )
    await db.commit()
    invalidate_settings_cache(admin.tenant_id)
    return await _email_templates_response(db, admin.tenant_id)


@router.post(
    "/settings/email-templates/{template_id}/restore",
    response_model=EmailTemplatesResponse,
    dependencies=[_admin_auth],
)
async def restore_email_template(
    template_id: str,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    from app.services.email_template_service import restore_template

    try:
        await restore_template(db, admin.tenant_id, template_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    await log_change(
        db,
        actor=admin,
        action="settings.email_template_restored",
        entity_type="settings",
        entity_id=None,
        subject_label=f"Email template: {template_id}",
        feature="email_templates",
        before=None,
        after={"template_id": template_id, "restored": True},
    )
    await db.commit()
    invalidate_settings_cache(admin.tenant_id)
    return await _email_templates_response(db, admin.tenant_id)


@router.post(
    "/settings/email-templates/{template_id}/preview",
    response_model=EmailTemplatePreviewResponse,
    dependencies=[_admin_auth],
)
async def preview_email_template(
    template_id: str,
    payload: EmailTemplatePreviewRequest,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    from app.services.email_template_service import get_company_name, preview_template

    try:
        rendered = preview_template(
            template_id,
            payload.subject,
            payload.body_html,
            company_name=await get_company_name(db, admin.tenant_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return EmailTemplatePreviewResponse(**rendered)


@router.post(
    "/settings/email-templates/{template_id}/test",
    status_code=status.HTTP_200_OK,
    dependencies=[_admin_auth],
)
async def test_email_template(
    template_id: str,
    payload: EmailTemplateTestRequest,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    from app.services.email_template_service import get_company_name, preview_template
    from app.services import gmail_service

    try:
        rendered = preview_template(
            template_id,
            payload.subject,
            payload.body_html,
            company_name=await get_company_name(db, admin.tenant_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    sent = gmail_service.send_html_email(
        to_email=payload.to_email,
        subject=f"[TEST] {rendered['subject']}",
        html_body=rendered["body_html"],
    )
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send test email")
    return {"ok": True, "to_email": payload.to_email}
