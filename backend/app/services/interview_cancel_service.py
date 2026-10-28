"""
Cancel a pending interview link.

Only a link the candidate has not opened can be cancelled here: an interview that is in
progress has a live room and recording to wind down, which is a separate action.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ConflictError, NotFoundError
from app.models.models import Candidate, InterviewSession, Job
from app.services.candidate_contact_service import (
    resolve_candidate_email,
    resolve_candidate_name,
)

logger = logging.getLogger(__name__)

# What the HR user is told when there is nothing to cancel, by the state the latest
# session is in.
_NOT_CANCELLABLE = {
    "in_progress": "The candidate is in the interview right now, so it cannot be cancelled here.",
    "completed": "This interview has already been completed.",
    "assessed": "This interview has already been completed.",
    "assessment_failed": "This interview has already been completed.",
    "expired": "This interview link has already expired.",
    "cancelled": "This interview has already been cancelled.",
}


async def cancel_pending_session(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
) -> InterviewSession:
    """
    Move the candidate's pending session to `cancelled` and kill its link.

    One conditional UPDATE, so it cannot overtake a candidate who is starting the interview
    in the same instant: whichever statement reaches the row first wins, and the other sees
    a session that is no longer pending. At most one session per candidate and job can be
    pending (a partial unique index), so there is exactly one row to report.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        update(InterviewSession)
        .where(
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.job_id == job_id,
            InterviewSession.status == "pending",
            # A link that has already lapsed is dead without our help (the pipeline files it
            # under Flagged as expired); cancelling it would rewrite that history.
            or_(InterviewSession.expires_at.is_(None), InterviewSession.expires_at > now),
        )
        .values(status="cancelled", expires_at=now)
        .returning(InterviewSession)
        .execution_options(populate_existing=True)
    )
    cancelled = result.scalars().first()
    if cancelled is not None:
        return cancelled

    latest = (
        await db.execute(
            select(InterviewSession)
            .where(InterviewSession.candidate_id == candidate_id, InterviewSession.job_id == job_id)
            .order_by(InterviewSession.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if latest is None:
        raise NotFoundError(public_message="There is no interview to cancel for this candidate.")
    status = "expired" if latest.status == "pending" else latest.status  # pending but past expiry
    raise ConflictError(
        public_message=_NOT_CANCELLABLE.get(status, "This interview cannot be cancelled.")
    )


async def send_cancelled_email(
    db: AsyncSession,
    session: InterviewSession,
    candidate: Candidate,
) -> bool:
    """Tell the candidate their interview was cancelled. Never raises: a mail outage must
    not undo the cancellation."""
    from app.services.email_service import send_interview_cancelled_notification
    from app.services.email_template_service import get_company_name, get_merged_templates

    candidate_email = resolve_candidate_email(candidate)
    if not candidate_email:
        logger.warning("Cannot send cancellation email: no valid email for candidate=%s", candidate.id)
        return False
    try:
        job = await db.get(Job, session.job_id)
        tenant_id = job.tenant_id if job else None
        return await send_interview_cancelled_notification(
            candidate_name=resolve_candidate_name(candidate),
            candidate_email=candidate_email,
            job_title=job.title if job else "the position",
            templates=await get_merged_templates(db, tenant_id),
            company_name=await get_company_name(db, tenant_id),
        )
    except Exception:  # noqa: BLE001 - see docstring
        logger.exception("Failed to send interview cancellation email to candidate=%s", candidate.id)
        return False
