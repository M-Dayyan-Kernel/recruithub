"""What a job's status allows. Every status check in the backend reads from here.

    open/active -> paused <-> open/active
    open/active | paused -> closed   (final)

Paused is "on hold": nothing new starts (uploads, approvals, calls, interview invites), but
nothing is lost either. Calls waiting to be dialled stay pending and go out after the job is
reactivated; links already sent keep working. Closed is "the role is done": undialled calls and
unused interview links are cancelled when it closes, the job is read-only, and it cannot be
reopened. Work already under way (a resume being read, a live call, an interview in progress,
its report) finishes in every state, and rejecting candidates always works.
"""

from __future__ import annotations

from typing import Protocol

from app.exceptions import JobClosedError, JobPausedError

# "active" is the backend default; the HR app writes "open" when it reactivates. Both are live.
ACTIVE = frozenset({"open", "active"})
PAUSED = "paused"
CLOSED = "closed"
DRAFT = "draft"
ALLOWED = ACTIVE | {PAUSED, CLOSED, DRAFT}


class _HasStatus(Protocol):
    status: str


def is_active(job: _HasStatus) -> bool:
    return job.status in ACTIVE


def is_paused(job: _HasStatus) -> bool:
    return job.status == PAUSED


def is_closed(job: _HasStatus) -> bool:
    return job.status == CLOSED


def assert_accepts_new_work(job: _HasStatus, what: str) -> None:
    """Refuse to start something new on a job that is not live.

    `what` finishes the sentence "Reactivate it to …", e.g. "send interview invites".
    """
    if is_closed(job):
        raise JobClosedError()
    if not is_active(job):
        raise JobPausedError(public_message=f"This job is paused. Reactivate it to {what}.")


def assert_editable(job: _HasStatus) -> None:
    """A paused job can still be edited; a closed one is a read-only record."""
    if is_closed(job):
        raise JobClosedError()


def assert_status_change_allowed(job: _HasStatus, new_status: str) -> None:
    if new_status not in ALLOWED:
        raise _invalid_status(new_status)
    if is_closed(job) and new_status != CLOSED:
        raise JobClosedError(
            public_message="A closed job cannot be reopened. Duplicate it to hire for this role again."
        )


def _invalid_status(value: str):
    from app.exceptions import ValidationError

    return ValidationError(public_message=f"Unknown job status: {value}.")
