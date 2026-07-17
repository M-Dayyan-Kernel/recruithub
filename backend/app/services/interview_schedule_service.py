"""
Interview scheduling helpers — parse HR-selected slot and notify candidates by email.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import settings
from app.models.models import Candidate, InterviewSession
from app.schemas.schemas import InterviewScheduleRequest
from app.services.candidate_contact_service import (
    resolve_candidate_email,
    resolve_candidate_name,
)

logger = logging.getLogger(__name__)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def parse_scheduled_at(body: InterviewScheduleRequest) -> datetime:
    if not _DATE_RE.match(body.scheduled_date):
        raise ValueError("scheduled_date must be YYYY-MM-DD")
    if not _TIME_RE.match(body.scheduled_time):
        raise ValueError("scheduled_time must be HH:MM")

    try:
        tz = ZoneInfo(body.timezone or "Asia/Kolkata")
    except Exception as exc:
        raise ValueError(f"Invalid timezone: {body.timezone}") from exc

    try:
        naive = datetime.strptime(
            f"{body.scheduled_date} {body.scheduled_time}",
            "%Y-%m-%d %H:%M",
        )
    except ValueError as exc:
        raise ValueError("Invalid scheduled date or time") from exc

    return naive.replace(tzinfo=tz).astimezone(timezone.utc)


def format_scheduled_at_label(
    scheduled_at: datetime,
    timezone_name: str = "Asia/Kolkata",
) -> str:
    """Human-readable slot label for emails and UI."""
    try:
        tz = ZoneInfo(timezone_name)
    except Exception:
        tz = ZoneInfo("Asia/Kolkata")
    local_dt = scheduled_at.astimezone(tz)
    return local_dt.strftime("%A, %d %B %Y at %I:%M %p").lstrip("0").replace(" 0", " ")


async def send_interview_invitation_email(
    db: AsyncSession,
    session: InterviewSession,
    candidate: Candidate,
    job_title: str,
) -> bool:
    from app.models.models import Job
    from app.services.email_service import send_interview_link
    from app.services.email_template_service import get_company_name, get_merged_templates

    job = await db.get(Job, session.job_id)
    tenant_id = job.tenant_id if job else None
    interview_url = f"{settings.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    templates = await get_merged_templates(db, tenant_id)
    company_name = await get_company_name(db, tenant_id)
    candidate_email = resolve_candidate_email(candidate)
    if not candidate_email:
        logger.warning(
            "Cannot send interview invitation — no valid email for candidate=%s",
            candidate.id,
        )
        return False

    sent = await send_interview_link(
        candidate_name=resolve_candidate_name(candidate),
        candidate_email=candidate_email,
        job_title=job_title,
        interview_url=interview_url,
        templates=templates,
        company_name=company_name,
    )
    if sent:
        session.email_sent_at = datetime.now(timezone.utc)
        logger.info(
            "Interview invitation sent to %s (session=%s)",
            candidate_email,
            session.id,
        )
    return sent


async def send_scheduled_interview_notification_email(
    db: AsyncSession,
    session: InterviewSession,
    candidate: Candidate,
    job_title: str,
    *,
    timezone_name: str,
) -> bool:
    from app.models.models import Job
    from app.services.email_service import send_scheduled_interview_notification
    from app.services.email_template_service import get_merged_templates

    if not session.scheduled_interview_at:
        return await send_interview_invitation_email(db, session, candidate, job_title)

    job = await db.get(Job, session.job_id)
    tenant_id = job.tenant_id if job else None
    interview_url = f"{settings.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    scheduled_label = format_scheduled_at_label(
        session.scheduled_interview_at,
        timezone_name,
    )
    templates = await get_merged_templates(db, tenant_id)
    candidate_email = resolve_candidate_email(candidate)
    if not candidate_email:
        logger.warning(
            "Cannot send scheduled interview notification — no valid email for candidate=%s",
            candidate.id,
        )
        return False

    sent = await send_scheduled_interview_notification(
        candidate_name=resolve_candidate_name(candidate),
        candidate_email=candidate_email,
        job_title=job_title,
        interview_url=interview_url,
        scheduled_at_label=scheduled_label,
        templates=templates,
    )
    if sent:
        session.email_sent_at = datetime.now(timezone.utc)
        logger.info(
            "Scheduled interview notification sent to %s (session=%s, slot=%s)",
            candidate_email,
            session.id,
            scheduled_label,
        )
    return sent


async def dispatch_due_scheduled_interview_emails(db: AsyncSession) -> int:
    """Legacy hook — scheduled slots are notified immediately when HR books them."""
    return 0
