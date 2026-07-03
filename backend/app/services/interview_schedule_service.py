"""
Interview scheduling helpers — parse HR-selected slot and send deferred invitations.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Candidate, InterviewSession, Job
from app.schemas.schemas import InterviewScheduleRequest

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


async def send_interview_invitation_email(
    session: InterviewSession,
    candidate: Candidate,
    job_title: str,
) -> bool:
    from app.services.email_service import send_interview_link

    interview_url = f"{settings.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    sent = send_interview_link(
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        job_title=job_title,
        interview_url=interview_url,
    )
    if sent:
        session.email_sent_at = datetime.now(timezone.utc)
        logger.info(
            "Interview invitation sent to %s (session=%s)",
            candidate.email,
            session.id,
        )
    return sent


async def dispatch_due_scheduled_interview_emails(db: AsyncSession) -> int:
    """Send interview links for sessions whose scheduled slot has arrived."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(InterviewSession, Candidate, Job)
        .join(Candidate, InterviewSession.candidate_id == Candidate.id)
        .join(Job, InterviewSession.job_id == Job.id)
        .where(
            InterviewSession.status == "pending",
            InterviewSession.email_sent_at.is_(None),
            InterviewSession.scheduled_interview_at.isnot(None),
            InterviewSession.scheduled_interview_at <= now,
        )
    )
    sent_count = 0
    for session, candidate, job in result.all():
        if await send_interview_invitation_email(session, candidate, job.title):
            sent_count += 1
    if sent_count:
        await db.commit()
    return sent_count
