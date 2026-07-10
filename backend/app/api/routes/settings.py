"""
System settings API — geography and outbound call restrictions.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
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
from app.services.settings_service import (
    invalidate_settings_cache,
    normalize_max_retries,
    normalize_retry_delay_seconds,
)

router = APIRouter()


async def _get_or_create_settings(db: AsyncSession) -> SystemSettings:
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    row = result.scalar_one_or_none()
    if row:
        return row

    row = SystemSettings(
        id=1,
        allowed_phone_regions=["IN"],
        enforce_phone_geography=True,
        screening_enabled=True,
        screening_max_retries=3,
        screening_retry_delay_seconds=1800,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/settings", response_model=SystemSettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """Return system-wide settings (geography, etc.)."""
    return await _get_or_create_settings(db)


@router.patch("/settings", response_model=SystemSettingsResponse)
async def update_settings(
    payload: SystemSettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update system-wide settings."""
    row = await _get_or_create_settings(db)
    data = payload.model_dump(exclude_unset=True)

    if "allowed_phone_regions" in data and data["allowed_phone_regions"] is not None:
        if not data["allowed_phone_regions"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="allowed_phone_regions must contain at least one region",
            )
        row.allowed_phone_regions = data["allowed_phone_regions"]

    if "enforce_phone_geography" in data and data["enforce_phone_geography"] is not None:
        row.enforce_phone_geography = data["enforce_phone_geography"]

    if "screening_enabled" in data and data["screening_enabled"] is not None:
        row.screening_enabled = data["screening_enabled"]

    if "screening_max_retries" in data and data["screening_max_retries"] is not None:
        try:
            row.screening_max_retries = normalize_max_retries(data["screening_max_retries"])
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

    if (
        "screening_retry_delay_seconds" in data
        and data["screening_retry_delay_seconds"] is not None
    ):
        try:
            row.screening_retry_delay_seconds = normalize_retry_delay_seconds(
                data["screening_retry_delay_seconds"]
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

    await db.commit()
    await db.refresh(row)
    invalidate_settings_cache()
    return row


@router.get("/settings/email-templates", response_model=EmailTemplatesResponse)
async def get_email_templates(db: AsyncSession = Depends(get_db)):
    from app.services.email_template_service import (
        REQUIRED_PLACEHOLDERS,
        get_merged_templates,
    )

    merged = await get_merged_templates(db)
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
    )


@router.patch("/settings/email-templates/{template_id}", response_model=EmailTemplatesResponse)
async def update_email_template(
    template_id: str,
    payload: EmailTemplateUpdate,
    db: AsyncSession = Depends(get_db),
):
    from app.services.email_template_service import (
        REQUIRED_PLACEHOLDERS,
        save_template,
        merge_templates,
    )

    try:
        merged = await save_template(db, template_id, payload.subject, payload.body_html)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    invalidate_settings_cache()
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
    )


@router.post(
    "/settings/email-templates/{template_id}/restore",
    response_model=EmailTemplatesResponse,
)
async def restore_email_template(template_id: str, db: AsyncSession = Depends(get_db)):
    from app.services.email_template_service import (
        REQUIRED_PLACEHOLDERS,
        restore_template,
    )

    try:
        merged = await restore_template(db, template_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    invalidate_settings_cache()
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
    )


@router.post(
    "/settings/email-templates/{template_id}/preview",
    response_model=EmailTemplatePreviewResponse,
)
async def preview_email_template(
    template_id: str,
    payload: EmailTemplatePreviewRequest,
):
    from app.services.email_template_service import preview_template

    try:
        rendered = preview_template(template_id, payload.subject, payload.body_html)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return EmailTemplatePreviewResponse(**rendered)


@router.post("/settings/email-templates/{template_id}/test", status_code=status.HTTP_200_OK)
async def test_email_template(
    template_id: str,
    payload: EmailTemplateTestRequest,
):
    from app.services.email_template_service import preview_template
    from app.services import gmail_service

    try:
        rendered = preview_template(template_id, payload.subject, payload.body_html)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    sent = gmail_service.send_html_email(
        to_email=payload.to_email,
        subject=rendered["subject"],
        html_body=rendered["body_html"],
    )
    if not sent:
        raise HTTPException(status_code=502, detail="Failed to send test email")
    return {"message": f"Test email sent to {payload.to_email}"}
