"""The statuses an interview session moves through, and what each means for HR actions.

    pending -> in_progress -> completed -> assessed | assessment_failed
       \\-> expired | cancelled   (the round was never taken)

Every place that asks "was this interview taken?" or "is it live?" reads from here, so the
answer is the same in the pipeline, the reschedule guard, the reject guard, and the sweeper.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_

from app.core.config_loader import config

PENDING = "pending"
IN_PROGRESS = "in_progress"
COMPLETED = "completed"
ASSESSED = "assessed"
ASSESSMENT_FAILED = "assessment_failed"
EXPIRED = "expired"
CANCELLED = "cancelled"

#: The candidate never took the interview, so the slot can still be moved.
UNTAKEN = frozenset({PENDING, EXPIRED, CANCELLED})
#: The candidate sat the interview. It is final: the next step is another round, not a reschedule.
TAKEN = frozenset({COMPLETED, ASSESSED, ASSESSMENT_FAILED})
#: Nothing more happens to the session by itself. A past-expiry sweep must leave these alone.
TERMINAL = TAKEN | {EXPIRED, CANCELLED}


def stale_after() -> timedelta:
    return timedelta(minutes=config.interview.stale_after_minutes)


def live_clause():
    """SQL twin of `is_live`: in_progress and started within the stale window."""
    from app.models.models import InterviewSession

    cutoff = datetime.now(timezone.utc) - stale_after()
    return (InterviewSession.status == IN_PROGRESS) & or_(
        InterviewSession.started_at.is_(None), InterviewSession.started_at > cutoff
    )


def is_live(session: Any) -> bool:
    """True while the candidate is in the room. A session past the stale window is stuck."""
    if session.status != IN_PROGRESS:
        return False
    started = session.started_at
    return started is None or started > datetime.now(timezone.utc) - stale_after()
