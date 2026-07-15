"""
Failed screening attempt notification — email candidates while still in Pending tab.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Candidate, Job, ScreeningCall
from app.services.email_service import send_failed_screening_attempt_email
from app.services.email_template_service import get_company_name, get_merged_templates
from app.services.settings_service import load_system_settings

logger = logging.getLogger(__name__)

FAILED_OUTCOMES = frozenset(
    {"no_answer", "voicemail", "dropped", "failed", "busy", "transport_error", "call_failed"}
)


def _is_valid_email(email: str | None) -> bool:
    if not email or email.endswith("@upload.pending"):
        return False
    return "@" in email


async def _would_be_flagged_after_failure(
    screening_call: ScreeningCall,
    phone: str | None,
    settings,
) -> bool:
    """Mirror screeningRows classifyTab logic for post-failure state."""
    from app.services.phone_validation import validate_phone_sync

    if not phone:
        return True
    if settings.enforce_phone_geography:
        ok, _, reason = validate_phone_sync(
            phone,
            enforce_geography=True,
            allowed_regions=list(settings.allowed_phone_regions),
        )
        if not ok:
            return True
    if screening_call.call_outcome == "declined":
        return True
    if screening_call.call_status == "failed" or screening_call.call_outcome == "failed":
        return True

    transcript = (screening_call.transcript or "").strip()
    if screening_call.call_outcome == "completed" or len(transcript) > 50:
        return False
    if screening_call.result in ("pass", "fail"):
        return False

    max_attempts = settings.screening_max_retries
    connect_failures = {"no_answer", "voicemail", "dropped", "busy", "transport_error", "call_failed"}
    if screening_call.call_outcome in connect_failures:
        if (screening_call.retry_count or 0) >= max_attempts - 1:
            return True
    return False


async def maybe_send_failed_screening_email(
    db: AsyncSession,
    screening_call: ScreeningCall,
) -> None:
    """
    Send a failed-attempt email when the candidate remains in the Pending screening tab.

    Skips when: no email, already sent for this call, moved to Flagged, or successful contact.
    """
    if screening_call.failed_attempt_email_sent_at:
        return

    outcome = (screening_call.call_outcome or "").lower()
    if outcome == "completed":
        return
    if outcome not in FAILED_OUTCOMES and screening_call.call_status != "failed":
        return

    if screening_call.result == "pass":
        return

    candidate = await db.get(Candidate, screening_call.candidate_id)
    if not candidate:
        logger.warning(
            "Skipping failed screening email — candidate %s not found",
            screening_call.candidate_id,
        )
        return

    job = await db.get(Job, screening_call.job_id)
    tenant_id = job.tenant_id if job else None
    job_title = job.title if job else "the position"

    phone = candidate.phone
    settings = await load_system_settings(db, tenant_id=tenant_id)

    if await _would_be_flagged_after_failure(screening_call, phone, settings):
        logger.info(
            "Skipping failed screening email for call %s — candidate would be flagged",
            screening_call.id,
        )
        return

    if not _is_valid_email(candidate.email):
        logger.warning(
            "Skipping failed screening email for call %s — no valid email for candidate %s",
            screening_call.id,
            screening_call.candidate_id,
        )
        screening_call.failed_attempt_email_status = "skipped_no_email"
        await db.commit()
        return

    templates = await get_merged_templates(db, tenant_id)
    company_name = await get_company_name(db, tenant_id)

    try:
        sent = await send_failed_screening_attempt_email(
            candidate_name=candidate.name,
            candidate_email=candidate.email,
            job_title=job_title,
            phone_number=phone or "your number on file",
            templates=templates,
            company_name=company_name,
        )
    except Exception as exc:
        logger.error(
            "Failed screening email error for call %s: %s",
            screening_call.id,
            exc,
        )
        screening_call.failed_attempt_email_status = "failed"
        await db.commit()
        return

    if sent:
        screening_call.failed_attempt_email_sent_at = datetime.now(timezone.utc)
        screening_call.failed_attempt_email_status = "sent"
        logger.info(
            "Failed screening attempt email sent to %s (call=%s)",
            candidate.email,
            screening_call.id,
        )
    else:
        screening_call.failed_attempt_email_status = "failed"
        logger.warning(
            "Failed screening attempt email delivery failed for %s (call=%s)",
            candidate.email,
            screening_call.id,
        )
    await db.commit()
