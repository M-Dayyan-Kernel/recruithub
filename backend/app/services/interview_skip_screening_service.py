"""
Skip voice screening — advance approved shortlist candidates directly to interviews.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Candidate, Job, ScreeningCall
from app.services.candidate_contact_service import resolve_candidate_email
from app.services.interview_schedule_service import send_interview_invitation_email
from app.services.interview_session_service import (
    create_pending_interview_session,
    get_active_interview_session,
)

logger = logging.getLogger(__name__)

from app.services.screening_gate_service import BYPASS_SUMMARY_JOB


@dataclass
class AdvanceResult:
    session_id: uuid.UUID | None
    created: bool
    email_sent: bool
    email_skipped_reason: str | None = None


async def _ensure_bypass_screening_call(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    bypass_summary: str = BYPASS_SUMMARY_JOB,
) -> ScreeningCall:
    result = await db.execute(
        select(ScreeningCall)
        .where(
            ScreeningCall.candidate_id == candidate_id,
            ScreeningCall.job_id == job_id,
            ScreeningCall.result == "pass",
        )
        .order_by(ScreeningCall.created_at.desc())
        .limit(1)
    )
    existing = result.scalars().first()
    if existing:
        if not existing.interview_queued_at:
            existing.interview_queued_at = datetime.now(timezone.utc)
            await db.flush()
        return existing

    now = datetime.now(timezone.utc)
    screening_call = ScreeningCall(
        candidate_id=candidate_id,
        job_id=job_id,
        call_status="completed",
        call_outcome="completed",
        result="pass",
        summary=bypass_summary,
        interview_queued_at=now,
    )
    db.add(screening_call)
    await db.flush()
    return screening_call


async def _send_invitation_if_needed(
    db: AsyncSession,
    *,
    interview_session,
    candidate: Candidate,
    job_title: str,
) -> tuple[bool, str | None]:
    if interview_session.email_sent_at:
        return False, None

    email = resolve_candidate_email(candidate)
    if not email:
        return False, "No valid email on file for this candidate"

    email_sent = await send_interview_invitation_email(
        db, interview_session, candidate, job_title
    )
    if not email_sent:
        return False, "Failed to send interview invitation email"
    return True, None


async def advance_approved_candidate_to_interview(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    bypass_summary: str = BYPASS_SUMMARY_JOB,
) -> AdvanceResult:
    """
    When voice screening is disabled, create a bypass pass record, interview session,
    and send the invitation email (non-fatal if email fails).
    """
    candidate = await db.get(Candidate, candidate_id)
    if not candidate:
        return AdvanceResult(
            session_id=None,
            created=False,
            email_sent=False,
            email_skipped_reason="Candidate not found",
        )

    job = await db.get(Job, job_id)
    job_title = job.title if job else "the position"

    existing_session = await get_active_interview_session(
        db, candidate_id=candidate_id, job_id=job_id
    )
    if existing_session:
        await _ensure_bypass_screening_call(
            db, candidate_id=candidate_id, job_id=job_id, bypass_summary=bypass_summary
        )
        email_sent, email_skipped_reason = await _send_invitation_if_needed(
            db,
            interview_session=existing_session,
            candidate=candidate,
            job_title=job_title,
        )
        await db.commit()
        return AdvanceResult(
            session_id=existing_session.id,
            created=False,
            email_sent=email_sent,
            email_skipped_reason=email_skipped_reason,
        )

    await _ensure_bypass_screening_call(
        db, candidate_id=candidate_id, job_id=job_id, bypass_summary=bypass_summary
    )

    try:
        interview_session, candidate, job_title = await create_pending_interview_session(
            db,
            candidate_id=candidate_id,
            job_id=job_id,
        )
    except ValueError as exc:
        logger.warning(
            "Could not create interview session for candidate=%s job=%s: %s",
            candidate_id,
            job_id,
            exc,
        )
        await db.commit()
        return AdvanceResult(
            session_id=None,
            created=False,
            email_sent=False,
            email_skipped_reason=str(exc),
        )

    email_sent, email_skipped_reason = await _send_invitation_if_needed(
        db,
        interview_session=interview_session,
        candidate=candidate,
        job_title=job_title,
    )
    if not resolve_candidate_email(candidate) and not email_skipped_reason:
        email_skipped_reason = "No valid email on file for this candidate"
        logger.warning(
            "Interview session created but no valid email for candidate=%s",
            candidate_id,
        )

    await db.commit()
    return AdvanceResult(
        session_id=interview_session.id,
        created=True,
        email_sent=email_sent,
        email_skipped_reason=email_skipped_reason,
    )
