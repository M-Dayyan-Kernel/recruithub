"""Closing a job: what it cancels, and the counts the close dialog shows beforehand.

Only work that has not started is cancelled. A call nobody has dialled and an interview link
nobody has opened are stopped; a call that is ringing, an interview in progress and the report
that follows are left to finish. Rows are kept (status `cancelled`), never deleted, so the
history of the job stays readable.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Candidate, InterviewSession, ScreeningCall, ShortlistResult
from app.services.screening_trigger_service import cancel_undialled_calls

JOB_CLOSED_SUMMARY = "Job closed"


@dataclass(frozen=True)
class CloseImpact:
    scheduled_calls: int
    unused_interview_links: int
    candidates_in_pipeline: int


def _undialled_calls(job_id: uuid.UUID):
    return and_(
        ScreeningCall.job_id == job_id,
        ScreeningCall.call_status == "pending",
        ScreeningCall.vapi_call_id.is_(None),
    )


def _unused_links(job_id: uuid.UUID, now: datetime):
    # A link already past expiry is dead without our help; cancelling it would rewrite history.
    return and_(
        InterviewSession.job_id == job_id,
        InterviewSession.status == "pending",
        or_(InterviewSession.expires_at.is_(None), InterviewSession.expires_at > now),
    )


async def close_impact(db: AsyncSession, job_id: uuid.UUID) -> CloseImpact:
    now = datetime.now(timezone.utc)
    calls = await db.scalar(select(func.count()).select_from(ScreeningCall).where(_undialled_calls(job_id)))
    links = await db.scalar(
        select(func.count()).select_from(InterviewSession).where(_unused_links(job_id, now))
    )
    # Still in the pipeline: neither rejected nor a finalist.
    decided = exists().where(
        ShortlistResult.candidate_id == Candidate.id,
        ShortlistResult.job_id == job_id,
        or_(ShortlistResult.hr_decision == "rejected", ShortlistResult.finalist_at.isnot(None)),
    )
    in_pipeline = await db.scalar(
        select(func.count()).select_from(Candidate).where(Candidate.job_id == job_id, ~decided)
    )
    return CloseImpact(
        scheduled_calls=int(calls or 0),
        unused_interview_links=int(links or 0),
        candidates_in_pipeline=int(in_pipeline or 0),
    )


async def wind_down_closed_job(db: AsyncSession, job_id: uuid.UUID) -> dict[str, int]:
    """Cancel the job's undialled calls and unused interview links. Caller commits."""
    calls = list((await db.execute(select(ScreeningCall).where(_undialled_calls(job_id)).with_for_update())).scalars())
    cancelled_calls = cancel_undialled_calls(calls, JOB_CLOSED_SUMMARY)

    now = datetime.now(timezone.utc)
    # One conditional UPDATE, like cancel_pending_session: a candidate opening the link in the
    # same instant either starts first (and keeps the interview) or finds it cancelled.
    result = await db.execute(
        update(InterviewSession)
        .where(_unused_links(job_id, now))
        .values(status="cancelled", expires_at=now)
        .returning(InterviewSession.id)
        .execution_options(synchronize_session=False)
    )
    cancelled_links = len(result.all())
    return {"cancelled_calls": cancelled_calls, "cancelled_interview_links": cancelled_links}
