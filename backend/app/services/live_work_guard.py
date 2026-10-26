"""Refuse to delete or erase something while a call or an interview is live.

A candidate on a Vapi call or inside a LiveKit room is mid-conversation. Deleting them
removes the database rows (and later the recording) underneath work that is still running,
and nothing in this app can end a live call or room (by decision: live things are never
stopped from here), so the only safe answer is "not now".
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ConflictError
from app.models.models import InterviewSession, ScreeningCall, ShortlistResult
from app.services.screening_trigger_service import call_is_on_its_way, call_on_its_way_clause

# An AI interview takes 20-30 minutes. One still "in progress" this long after it started is
# stuck (the room-finished webhook never arrived: it cannot reach localhost, and a dropped
# connection can miss it), not live. Without a bound, such a candidate, and their whole job,
# could never be deleted again, and retrying would never help.
STALE_INTERVIEW_AFTER = timedelta(hours=3)

_CANDIDATE_ON_CALL = "This candidate is on a call right now. Try again when it ends."
_CANDIDATE_IN_INTERVIEW = "This candidate is in an interview right now. Try again when it ends."


def _interview_live_clause():
    cutoff = datetime.now(timezone.utc) - STALE_INTERVIEW_AFTER
    return (InterviewSession.status == "in_progress") & or_(
        InterviewSession.started_at.is_(None), InterviewSession.started_at > cutoff
    )


async def assert_candidate_not_live(
    db: AsyncSession, job_id: uuid.UUID, candidate_id: uuid.UUID
) -> None:
    """Raise ConflictError if the candidate is on a call or in an interview.

    Takes the candidate's shortlist row, calls and interview sessions (the order every other
    path uses) and holds them until the caller commits. A dial that starts meanwhile waits
    behind this transaction, and so does an interview start: its atomic pending -> in_progress
    UPDATE queues on the session row and then finds it gone, instead of slipping in between
    the check and the delete.
    """
    await db.execute(
        select(ShortlistResult.id)
        .where(ShortlistResult.job_id == job_id, ShortlistResult.candidate_id == candidate_id)
        .with_for_update()
    )
    calls = (
        await db.execute(
            select(ScreeningCall)
            .where(ScreeningCall.job_id == job_id, ScreeningCall.candidate_id == candidate_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    if any(call_is_on_its_way(c) for c in calls):
        raise ConflictError(public_message=_CANDIDATE_ON_CALL)
    live_interview = (
        await db.execute(
            select(InterviewSession.id)
            .where(
                InterviewSession.job_id == job_id,
                InterviewSession.candidate_id == candidate_id,
                _interview_live_clause(),
            )
            .with_for_update()
            .limit(1)
        )
    ).scalars().first()
    if live_interview is not None:
        raise ConflictError(public_message=_CANDIDATE_IN_INTERVIEW)
    # Not live, but a pending link could be opened at this instant: lock those rows too so
    # the start waits for this transaction (and then finds nothing) rather than racing it.
    await db.execute(
        select(InterviewSession.id)
        .where(
            InterviewSession.job_id == job_id,
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.status == "pending",
        )
        .with_for_update()
    )


async def assert_job_not_live(db: AsyncSession, job_id: uuid.UUID) -> None:
    """Raise ConflictError if anyone on the job is on a call or in an interview.

    Read-only (no row locks): a job delete is rare and cascades through many tables, and
    locking every candidate's rows for it would be the larger risk. A call or interview that
    starts in the instant between this check and the commit is not caught.
    """
    on_call = set(
        (
            await db.execute(
                select(ScreeningCall.candidate_id).where(
                    ScreeningCall.job_id == job_id, call_on_its_way_clause()
                )
            )
        )
        .scalars()
        .all()
    )
    in_interview = set(
        (
            await db.execute(
                select(InterviewSession.candidate_id).where(
                    InterviewSession.job_id == job_id, _interview_live_clause()
                )
            )
        )
        .scalars()
        .all()
    )
    live = len(on_call | in_interview)  # one candidate in both states counts once
    if live:
        who = "1 candidate is" if live == 1 else f"{live} candidates are"
        raise ConflictError(
            public_message=f"{who} on a call or in an interview right now. Try again when they finish."
        )
