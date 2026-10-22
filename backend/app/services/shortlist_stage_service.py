"""Where an approved candidate currently is in the pipeline.

The Resume Screening tab stops being a decision row once a candidate is approved: it
shows which stage they are in and links to the tab that owns the next action. Working
that out here, in one batch, keeps the page from re-deriving it from three endpoints and
keeps its answer the same as the Phone screening and Interviews tabs.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import InterviewReport, InterviewSession, ScreeningCall
from app.schemas.schemas import ShortlistStage
from app.services.interview_flag_service import get_flag_reason
from app.services.interview_pipeline_service import classify_interview_tab
from app.services.settings_cache_service import CachedSettings

_LIVE_CALL_STATUSES = frozenset({"initiated", "in_progress"})
_CONNECT_FAILURES = frozenset({"no_answer", "voicemail", "dropped"})
_SUBSTANTIVE_TRANSCRIPT_CHARS = 50
# A fresh retry that has just been dialled still reads as "retrying" for a moment.
_RETRY_GRACE = timedelta(seconds=25)


# The call-based rules below are a port of `classifyTab` and `latestCallForCandidate` in
# hr-app/src/components/screening/screeningRows.ts. The Phone screening tab is where the
# link from the Resume Screening tab lands, so the two must name the same state; if one
# changes, change the other.


def _newest(items):
    return max(items, key=lambda i: i.created_at)


def _is_live(call: ScreeningCall) -> bool:
    return call.call_status in _LIVE_CALL_STATUSES


def _is_scheduled_retry(call: ScreeningCall) -> bool:
    return call.call_status == "pending" and not call.vapi_call_id


def _is_technical_failure(call: ScreeningCall) -> bool:
    return call.call_status == "failed" or call.call_outcome == "failed"


def _transcript(call: ScreeningCall) -> str:
    return (call.transcript or "").strip()


# Waiting in the phone round with no call result: what the voice-screening switch must
# place somewhere when it is turned off.
PHONE_ROUND_STATES = frozenset({"queued", "scheduled", "retrying", "flagged", "cancelled"})


def is_successful_call(call: ScreeningCall) -> bool:
    return _is_successful(call)


def _is_successful(call: ScreeningCall) -> bool:
    """A call where the candidate was actually reached and screened."""
    if call.call_status != "completed":
        return False
    if call.call_outcome == "completed" or call.result in ("pass", "fail"):
        return True
    if call.result == "needs_review" and _transcript(call):
        return True
    return len(_transcript(call)) > _SUBSTANTIVE_TRANSCRIPT_CHARS


def _pick_call(calls: list[ScreeningCall]) -> ScreeningCall:
    live = [c for c in calls if _is_live(c)]
    if live:
        return _newest(live)
    successful = [c for c in calls if _is_successful(c)]
    if successful:
        best = _newest(successful)
        # Calls made after it belong to a later round (approved again after this result),
        # which is what is happening now. A success cancels its own pending retries, so
        # nothing newer is left over from the same round.
        later = [c for c in calls if c.created_at > best.created_at]
        return _newest(later) if later else best
    scheduled = [c for c in calls if _is_scheduled_retry(c)]
    if scheduled:
        return _newest(scheduled)
    return _newest(calls)


def _phone_looks_indian(phone: str) -> bool:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return (digits.startswith("91") and len(digits) == 12) or len(digits) == 10


def _by_result(call: ScreeningCall) -> ShortlistStage:
    if call.result == "pass":
        # Passed: the next thing that happens is an interview.
        return ShortlistStage(kind="interview", state="pending")
    if call.result == "fail":
        return ShortlistStage(kind="screening", state="failed")
    return ShortlistStage(kind="screening", state="review")


def _flagged(reason: str) -> ShortlistStage:
    return ShortlistStage(kind="screening", state="flagged", reason=reason)


def _screening_stage(
    call: ScreeningCall | None,
    phone: str | None,
    settings: CachedSettings | None,
    now: datetime,
) -> ShortlistStage:
    # A call that already reached the candidate has its outcome; today's phone number does
    # not change it. (Same order as the Phone screening tab.)
    reached = call is not None and _is_successful(call)
    if not reached and not phone:
        return _flagged("No phone number on file")
    if (
        not reached
        and settings is not None
        and settings.enforce_phone_geography
        and "IN" in (settings.allowed_phone_regions or [])
        and not _phone_looks_indian(phone)
    ):
        return _flagged("Phone number is not in the allowed region")
    if call is None:
        return ShortlistStage(kind="screening", state="queued")
    if call.call_status == "cancelled":
        # HR cancelled the queued call. The Phone screening tab files it under Pending,
        # where "Call Now" starts a new one.
        return ShortlistStage(kind="screening", state="cancelled")
    if call.call_outcome == "declined":
        return _flagged("Candidate declined the call")
    if _is_technical_failure(call):
        return _flagged("The call could not connect")
    if _is_live(call):
        return ShortlistStage(kind="screening", state="live")
    if _is_scheduled_retry(call):
        return ShortlistStage(kind="screening", state="scheduled")
    if call.call_status == "pending":
        # A call that has been placed but not yet answered by the webhook: the Phone
        # screening tab files it under Pending, not as a live call.
        return ShortlistStage(kind="screening", state="queued")
    if _is_successful(call):
        return _by_result(call)
    if call.call_outcome in _CONNECT_FAILURES:
        max_attempts = settings.screening_max_retries if settings is not None else 3
        if (call.retry_count or 0) >= max_attempts - 1:
            fresh = call.created_at is not None and (now - call.created_at) < _RETRY_GRACE
            if (call.retry_count or 0) > 0 and fresh:
                return ShortlistStage(kind="screening", state="retrying")
            return _flagged("Could not reach the candidate after the maximum attempts")
        return ShortlistStage(kind="screening", state="retrying")
    if call.call_status == "completed" and (
        call.call_outcome == "completed"
        or call.result in ("pass", "fail", "needs_review")
        or _transcript(call)
    ):
        return _by_result(call)
    return ShortlistStage(kind="screening", state="queued")


def _interview_stage(session: InterviewSession, has_report: bool) -> ShortlistStage:
    """Whatever tab the Interviews page files this session under, name it the same way."""
    if session.status == "cancelled":
        # Filed under Scheduled (needs a link) by the Interviews tab; say why.
        return ShortlistStage(kind="interview", state="cancelled")
    tab = classify_interview_tab(session, has_report=has_report)
    if tab == "flagged":
        return ShortlistStage(
            kind="interview",
            state="flagged",
            reason=get_flag_reason(session, has_report=has_report),
        )
    if tab == "ongoing":
        return ShortlistStage(kind="interview", state="live")
    if tab == "finalists":
        return ShortlistStage(kind="interview", state="finalist")
    if tab == "completed":
        return ShortlistStage(kind="interview", state="completed")
    return ShortlistStage(kind="interview", state="link_sent", scheduled_at=session.scheduled_interview_at)


def resolve_shortlist_stage(
    hr_decision: str,
    calls: list[ScreeningCall],
    sessions: list[InterviewSession],
    *,
    has_report: bool = False,
    phone: str | None,
    settings: CachedSettings | None = None,
    screening_effective: bool = True,
    now: datetime | None = None,
) -> ShortlistStage | None:
    """None unless the candidate is approved: other decisions have no stage to show."""
    if hr_decision != "approved":
        return None
    # An interview session always supersedes the call that led to it (and a candidate
    # approved with screening switched off never had a call).
    if sessions:
        return _interview_stage(_newest(sessions), has_report)
    if not screening_effective and not calls:
        return ShortlistStage(kind="interview", state="pending")
    call = _pick_call(calls) if calls else None
    stage = _screening_stage(call, phone, settings, now or datetime.now(timezone.utc))
    if not screening_effective and stage.kind == "screening" and stage.state in PHONE_ROUND_STATES:
        # Screening is off and nothing will call them: they wait for HR to place them
        # (the voice-screening switch offers that).
        return ShortlistStage(kind="screening", state="paused")
    return stage


async def load_stages(
    db: AsyncSession,
    job_id: uuid.UUID,
    approved_candidate_ids: list[uuid.UUID],
) -> dict[uuid.UUID, tuple[list[ScreeningCall], list[InterviewSession], bool]]:
    """Calls, interview sessions and whether a report exists, for the given candidates on
    one job: three queries however many candidates."""
    if not approved_candidate_ids:
        return {}
    calls_by: dict[uuid.UUID, list[ScreeningCall]] = defaultdict(list)
    sessions_by: dict[uuid.UUID, list[InterviewSession]] = defaultdict(list)
    calls = await db.execute(
        select(ScreeningCall).where(
            ScreeningCall.job_id == job_id,
            ScreeningCall.candidate_id.in_(approved_candidate_ids),
        )
    )
    for call in calls.scalars().all():
        calls_by[call.candidate_id].append(call)
    sessions = await db.execute(
        select(InterviewSession).where(
            InterviewSession.job_id == job_id,
            InterviewSession.candidate_id.in_(approved_candidate_ids),
        )
    )
    for session in sessions.scalars().all():
        sessions_by[session.candidate_id].append(session)
    reports = await db.execute(
        select(InterviewReport.candidate_id).where(
            InterviewReport.job_id == job_id,
            InterviewReport.candidate_id.in_(approved_candidate_ids),
        )
    )
    with_report = set(reports.scalars().all())
    return {
        cid: (calls_by[cid], sessions_by[cid], cid in with_report)
        for cid in approved_candidate_ids
    }
