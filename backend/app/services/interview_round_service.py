"""Interview rounds: which round is current, what HR may do with it, and moving between rounds.

An application (a candidate on a job) has up to `interview.max_rounds` rounds, each one an
`InterviewSession`. The rules, in one place:

    round state                    HR can
    ---------------------------    --------------------------------------------------
    none yet                       schedule / send the first round's link
    pending, expired, cancelled    reschedule (the same session moves; its link is kept)
    in progress                    nothing: the interview is live
    completed / assessed / failed  schedule the next round, void it, or mark a finalist

Scheduling the next round is the approval of the previous one, so a round carries no decision
of its own: the application is a finalist (`ShortlistResult.finalist_at`) or rejected
(`ShortlistResult.hr_decision`). The functions here change state and flush; the caller writes the
audit row, sends the email, and commits.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.models.models import InterviewSession, ShortlistResult
from app.services.interview_status import (
    ASSESSMENT_FAILED,
    CANCELLED,
    EXPIRED,
    PENDING,
    TAKEN,
    UNTAKEN,
    is_live,
)

# Values of `available_actions` on a pipeline row. The UI renders exactly these.
ACTION_SCHEDULE = "schedule"
ACTION_RESCHEDULE = "reschedule"
ACTION_CANCEL = "cancel"
ACTION_NEXT_ROUND = "next_round"
ACTION_VOID_ROUND = "void_round"
ACTION_MARK_FINALIST = "mark_finalist"
ACTION_RETRY_ASSESSMENT = "retry_assessment"
ACTION_REJECT = "reject"


def counted_rounds(sessions: Iterable[InterviewSession]) -> list[InterviewSession]:
    """The application's rounds in order. A voided session is replaced by its retake."""
    return sorted(
        (s for s in sessions if s.voided_at is None),
        key=lambda s: (s.round_number, s.created_at),
    )


def latest_round(sessions: Iterable[InterviewSession]) -> Optional[InterviewSession]:
    rounds = counted_rounds(sessions)
    return rounds[-1] if rounds else None


def available_actions(
    sessions: Iterable[InterviewSession],
    *,
    rejected: bool,
    finalist: bool,
    flagged: bool = False,
    has_report: bool = False,
) -> list[str]:
    """What HR can do with this application's interview, decided once for every screen.

    `flagged` is a taken interview that never produced a meaningful result; it can be voided or
    moved on, but not marked a finalist. `has_report` gates cancel: a session with a report is done.
    """
    sessions = list(sessions)
    latest = latest_round(sessions)
    if rejected:
        return []
    if latest is None:
        return [ACTION_SCHEDULE, ACTION_REJECT]
    if is_live(latest):
        return []

    actions: list[str] = []
    if latest.status in UNTAKEN:
        actions.append(ACTION_RESCHEDULE)
        if latest.status == PENDING and not has_report:
            actions.append(ACTION_CANCEL)
    elif latest.status in TAKEN:
        if latest.status == ASSESSMENT_FAILED:
            actions.append(ACTION_RETRY_ASSESSMENT)
        if not finalist:
            # A finalist's interview can no longer change (see _refuse_untouchable).
            if len(counted_rounds(sessions)) < config.interview.max_rounds:
                actions.append(ACTION_NEXT_ROUND)
            if not flagged:
                actions.append(ACTION_MARK_FINALIST)
            actions.append(ACTION_VOID_ROUND)
    else:
        # in_progress past the stale window: stuck. The sweeper settles it; until then HR waits.
        return []
    # Rejecting is the Rejected stage's action: any time the candidate is not in the room, and
    # never once they are a finalist.
    if not finalist:
        actions.append(ACTION_REJECT)
    return actions


# ---------------------------------------------------------------------------
# State changes
# ---------------------------------------------------------------------------

def _slot_expiry(scheduled_at: Optional[datetime]) -> datetime:
    return (scheduled_at or datetime.now(timezone.utc)) + timedelta(
        days=config.interview.session_link_ttl_days
    )


def _clear_attempt(session: InterviewSession) -> None:
    """Forget what a started-but-not-completed attempt left behind, so the round starts clean."""
    session.started_at = None
    session.completed_at = None
    session.livekit_room_name = None
    session.egress_id = None
    session.recording_key = None
    session.recording_ready = None
    session.transcript = None
    session.transcript_segments = None


def _new_session(
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    round_number: int,
    scheduled_at: Optional[datetime],
) -> InterviewSession:
    return InterviewSession(
        candidate_id=candidate_id,
        job_id=job_id,
        unique_token=str(uuid.uuid4()),
        status=PENDING,
        round_number=round_number,
        scheduled_interview_at=scheduled_at,
        expires_at=_slot_expiry(scheduled_at),
    )


async def load_sessions(
    db: AsyncSession, candidate_id: uuid.UUID, job_id: uuid.UUID, *, lock: bool = False
) -> list[InterviewSession]:
    """Every session of the application, voided ones included. Locks the rows when asked."""
    stmt = select(InterviewSession).where(
        InterviewSession.candidate_id == candidate_id, InterviewSession.job_id == job_id
    )
    if lock:
        stmt = stmt.with_for_update()
    return list((await db.execute(stmt)).scalars().all())


async def _shortlist(
    db: AsyncSession, candidate_id: uuid.UUID, job_id: uuid.UUID
) -> Optional[ShortlistResult]:
    """The application's shortlist row, locked first (the order every other path uses)."""
    return (
        await db.execute(
            select(ShortlistResult)
            .where(ShortlistResult.job_id == job_id, ShortlistResult.candidate_id == candidate_id)
            .with_for_update()
        )
    ).scalars().first()


def _refuse_untouchable(shortlist: Optional[ShortlistResult]) -> None:
    if shortlist is not None and shortlist.hr_decision == "rejected":
        raise ConflictError(
            public_message="This candidate was rejected. Reconsider them before changing the interview."
        )
    if shortlist is not None and shortlist.finalist_at is not None:
        raise ConflictError(
            public_message="This candidate is a finalist; the interview can no longer be changed."
        )


def _refuse_if_live(latest: InterviewSession) -> None:
    if is_live(latest):
        raise ConflictError(public_message="Interview in progress. Try again when it ends.")


def _refuse_if_past(scheduled_at: Optional[datetime]) -> None:
    if scheduled_at is not None and scheduled_at < datetime.now(timezone.utc) - timedelta(minutes=1):
        raise ValidationError(public_message="Scheduled time must be in the future.")


async def place_first_round(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    scheduled_at: Optional[datetime] = None,
) -> InterviewSession:
    """Give the application its first interview: a new round 1, or a cancelled/expired one reopened.

    Used by "send link", "schedule" and skip-screening. A round that is already pending, live or
    taken is not touched: those have their own actions (reschedule, next round).
    """
    _refuse_if_past(scheduled_at)
    shortlist = await _shortlist(db, candidate_id, job_id)
    _refuse_untouchable(shortlist)
    latest = latest_round(await load_sessions(db, candidate_id, job_id, lock=True))

    if latest is None:
        session = _new_session(
            candidate_id=candidate_id, job_id=job_id, round_number=1, scheduled_at=scheduled_at
        )
        db.add(session)
        await db.flush()
        return session
    _refuse_if_live(latest)
    if latest.status == PENDING:
        raise ConflictError(
            public_message="An active interview session already exists for this candidate."
        )
    if latest.status in TAKEN:
        raise ConflictError(
            public_message="This candidate has already taken this round. Schedule the next round."
        )
    return await _reopen(db, latest, scheduled_at)


async def reschedule_round(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    scheduled_at: Optional[datetime] = None,
) -> tuple[InterviewSession, Optional[datetime]]:
    """Move the current round to a new time. Only a round the candidate has not taken can move.

    The same session is updated, so its link and its question plan are kept. Returns the session
    and the slot it had before, for the audit row.
    """
    _refuse_if_past(scheduled_at)
    shortlist = await _shortlist(db, candidate_id, job_id)
    _refuse_untouchable(shortlist)
    latest = latest_round(await load_sessions(db, candidate_id, job_id, lock=True))
    if latest is None:
        raise ValidationError(public_message="There is no interview to reschedule. Schedule one instead.")
    _refuse_if_live(latest)
    if latest.status in TAKEN:
        raise ConflictError(
            public_message="This round was already taken. Schedule the next round instead."
        )
    previous_slot = latest.scheduled_interview_at
    return await _reopen(db, latest, scheduled_at), previous_slot


async def _reopen(
    db: AsyncSession, session: InterviewSession, scheduled_at: Optional[datetime]
) -> InterviewSession:
    if session.status in (EXPIRED, CANCELLED):
        _clear_attempt(session)
    session.status = PENDING
    session.scheduled_interview_at = scheduled_at
    session.expires_at = _slot_expiry(scheduled_at)
    await db.flush()
    return session


async def schedule_next_round(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    scheduled_at: Optional[datetime] = None,
) -> InterviewSession:
    """Open the next round after a taken one. Scheduling it is the approval of the previous round."""
    _refuse_if_past(scheduled_at)
    shortlist = await _shortlist(db, candidate_id, job_id)
    _refuse_untouchable(shortlist)
    sessions = await load_sessions(db, candidate_id, job_id, lock=True)
    rounds = counted_rounds(sessions)
    latest = rounds[-1] if rounds else None
    if latest is None:
        raise ValidationError(public_message="There is no earlier round. Schedule the first interview instead.")
    _refuse_if_live(latest)
    if latest.status not in TAKEN:
        raise ConflictError(
            public_message="The current round has not been taken yet. Reschedule it instead."
        )
    if len(rounds) >= config.interview.max_rounds:
        raise ConflictError(
            public_message=f"A candidate can have at most {config.interview.max_rounds} interview rounds."
        )
    session = _new_session(
        candidate_id=candidate_id,
        job_id=job_id,
        round_number=latest.round_number + 1,
        scheduled_at=scheduled_at,
    )
    db.add(session)
    await db.flush()
    return session


async def void_round(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    reason: str,
    actor_id: uuid.UUID,
) -> tuple[InterviewSession, InterviewSession]:
    """Void the current taken round and open a retake with the same round number.

    The voided session keeps its report and recording for the record, and does not count toward
    the round cap. Returns (voided, retake).
    """
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError(public_message="Give a reason for voiding this round.")
    shortlist = await _shortlist(db, candidate_id, job_id)
    _refuse_untouchable(shortlist)
    latest = latest_round(await load_sessions(db, candidate_id, job_id, lock=True))
    if latest is None or latest.status not in TAKEN:
        raise ConflictError(public_message="Only a round the candidate has taken can be voided.")
    _refuse_if_live(latest)

    latest.voided_at = datetime.now(timezone.utc)
    latest.voided_by_user_id = actor_id
    latest.void_reason = reason
    # The partial unique index lets the retake share the round number once this one is voided,
    # but it must see the voided row first.
    await db.flush()
    retake = _new_session(
        candidate_id=candidate_id, job_id=job_id, round_number=latest.round_number, scheduled_at=None
    )
    db.add(retake)
    await db.flush()
    return latest, retake


async def mark_finalist(
    db: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    actor_id: uuid.UUID,
    flagged: bool,
) -> ShortlistResult:
    """Mark the application a finalist. Needs a taken, meaningful current round; irreversible."""
    shortlist = await _shortlist(db, candidate_id, job_id)
    if shortlist is None:
        raise NotFoundError(public_message="Candidate not found")
    if shortlist.hr_decision == "rejected":
        raise ConflictError(
            public_message="This candidate was rejected. Reconsider them before deciding on the interview."
        )
    if shortlist.finalist_at is not None:
        return shortlist
    latest = latest_round(await load_sessions(db, candidate_id, job_id, lock=True))
    if latest is None or latest.status not in TAKEN or flagged:
        raise ValidationError(public_message="Interview must be completed before marking a finalist")
    shortlist.finalist_at = datetime.now(timezone.utc)
    shortlist.finalist_by_user_id = actor_id
    await db.flush()
    return shortlist
