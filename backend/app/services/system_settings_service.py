"""System settings CRUD and email template orchestration."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_utils import run_sync
from app.exceptions import NotFoundError, ServiceUnavailableError, ValidationError
from app.models.models import SystemSettings, User
from app.repositories.system_settings_repository import SystemSettingsRepository
from app.schemas.schemas import (
    EmailTemplateEntry,
    EmailTemplatePreviewRequest,
    EmailTemplatePreviewResponse,
    EmailTemplateTestRequest,
    EmailTemplatesResponse,
    SystemSettingsUpdate,
)
from app.services.audit_service import AuditService
from app.services.settings_cache_service import (
    SettingsCacheService,
    normalize_max_retries,
    normalize_retry_delay_seconds,
)

logger = logging.getLogger(__name__)


class SystemSettingsService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        settings_repo: SystemSettingsRepository | None = None,
        audit_service: AuditService | None = None,
        cache_service: SettingsCacheService | None = None,
    ) -> None:
        self._session = session
        self._settings = settings_repo or SystemSettingsRepository(session)
        self._audit = audit_service or AuditService(session)
        self._cache = cache_service or SettingsCacheService(session, settings_repo=self._settings)

    async def get_settings(self, tenant_id: uuid.UUID) -> SystemSettings:
        return await self._settings.get_or_create(tenant_id, commit=True)

    async def update_settings(
        self, admin: User, payload: SystemSettingsUpdate
    ) -> SystemSettings:
        row = await self._settings.get_or_create(admin.tenant_id)
        data = payload.model_dump(exclude_unset=True)
        changes: dict = {}

        if "allowed_phone_regions" in data and data["allowed_phone_regions"] is not None:
            if not data["allowed_phone_regions"]:
                raise ValidationError(
                    public_message="allowed_phone_regions must contain at least one region",
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
                raise ValidationError(public_message=str(exc)) from exc
            changes["screening_max_retries"] = (row.screening_max_retries, new_val)
            row.screening_max_retries = new_val

        if (
            "screening_retry_delay_seconds" in data
            and data["screening_retry_delay_seconds"] is not None
        ):
            try:
                new_val = normalize_retry_delay_seconds(data["screening_retry_delay_seconds"])
            except ValueError as exc:
                raise ValidationError(public_message=str(exc)) from exc
            changes["screening_retry_delay_seconds"] = (
                row.screening_retry_delay_seconds,
                new_val,
            )
            row.screening_retry_delay_seconds = new_val

        if "company_name" in data and data["company_name"] is not None:
            new_name = str(data["company_name"]).strip()
            if not new_name:
                raise ValidationError(public_message="company_name cannot be empty")
            if len(new_name) > 255:
                raise ValidationError(
                    public_message="company_name must be at most 255 characters",
                )
            changes["company_name"] = (row.company_name, new_name)
            row.company_name = new_name

        await self._audit.log_field_changes(
            actor=admin,
            action="settings.updated",
            entity_type="settings",
            entity_id=None,
            subject_label="System settings",
            changes=changes,
        )
        await self._session.commit()
        await self._settings.refresh(row)
        SettingsCacheService.invalidate(admin.tenant_id)
        logger.info(
            "Updated system settings for tenant_id=%s fields=%s",
            admin.tenant_id,
            list(changes.keys()),
        )
        return row

    async def get_email_templates(self, tenant_id: uuid.UUID) -> EmailTemplatesResponse:
        return await self._email_templates_response(tenant_id)

    async def update_email_template(
        self, admin: User, template_id: str, payload
    ) -> EmailTemplatesResponse:
        from app.services.email_template_service import get_merged_templates, save_template

        before_merged = await get_merged_templates(self._session, admin.tenant_id)
        before_entry = before_merged.get(template_id) or {}
        try:
            import bleach

            allowed_tags = bleach.sanitizer.ALLOWED_TAGS.union(
                {"p", "br", "div", "span", "h1", "h2", "h3", "a", "ul", "ol", "li", "strong", "em"}
            )
            allowed_attrs = {"*": ["style", "class", "href", "target", "rel"]}
            safe_html = bleach.clean(
                payload.body_html,
                tags=list(allowed_tags),
                attributes=allowed_attrs,
                strip=True,
            )
            await save_template(
                self._session, admin.tenant_id, template_id, payload.subject, safe_html
            )
        except ValueError as exc:
            raise ValidationError(public_message=str(exc)) from exc

        await self._audit.log_change(
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
        await self._session.commit()
        SettingsCacheService.invalidate(admin.tenant_id)
        return await self._email_templates_response(admin.tenant_id)

    async def restore_email_template(
        self, admin: User, template_id: str
    ) -> EmailTemplatesResponse:
        from app.services.email_template_service import restore_template

        try:
            await restore_template(self._session, admin.tenant_id, template_id)
        except ValueError as exc:
            raise NotFoundError(public_message=str(exc)) from exc

        await self._audit.log_change(
            actor=admin,
            action="settings.email_template_restored",
            entity_type="settings",
            entity_id=None,
            subject_label=f"Email template: {template_id}",
            feature="email_templates",
            before=None,
            after={"template_id": template_id, "restored": True},
        )
        await self._session.commit()
        SettingsCacheService.invalidate(admin.tenant_id)
        return await self._email_templates_response(admin.tenant_id)

    async def preview_email_template(
        self, tenant_id: uuid.UUID, template_id: str, payload: EmailTemplatePreviewRequest
    ) -> EmailTemplatePreviewResponse:
        from app.services.email_template_service import get_company_name, preview_template

        try:
            rendered = preview_template(
                template_id,
                payload.subject,
                payload.body_html,
                company_name=await get_company_name(self._session, tenant_id),
            )
        except ValueError as exc:
            raise ValidationError(public_message=str(exc)) from exc
        return EmailTemplatePreviewResponse(**rendered)

    async def test_email_template(
        self, admin: User, template_id: str, payload: EmailTemplateTestRequest
    ) -> dict:
        from app.services import gmail_service
        from app.services.email_template_service import get_company_name, preview_template

        try:
            rendered = preview_template(
                template_id,
                payload.subject,
                payload.body_html,
                company_name=await get_company_name(self._session, admin.tenant_id),
            )
        except ValueError as exc:
            raise ValidationError(public_message=str(exc)) from exc

        gmail_token = await gmail_service.get_tenant_gmail_token(self._session, admin.tenant_id)
        sent = await run_sync(
            gmail_service.send_html_email,
            to_email=payload.to_email,
            subject=f"[TEST] {rendered['subject']}",
            html_body=rendered["body_html"],
            gmail_token_json=gmail_token,
        )
        if not sent:
            raise ServiceUnavailableError(
                public_message=f"Failed to send test email. {gmail_service.email_transport_hint()}",
            )
        return {"ok": True, "to_email": payload.to_email}

    async def _email_templates_response(self, tenant_id: uuid.UUID) -> EmailTemplatesResponse:
        from app.services.email_template_service import (
            COMMON_PLACEHOLDERS,
            REQUIRED_PLACEHOLDERS,
            get_company_name,
            get_merged_templates,
        )

        merged = await get_merged_templates(self._session, tenant_id)
        company_name = await get_company_name(self._session, tenant_id)
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
