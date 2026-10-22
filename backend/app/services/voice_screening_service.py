"""
Switch a job's voice screening on or off, and decide where the phone round goes.

Turning screening off used to be a bare flag flip: candidates waiting for a call were left
behind (the dialler then marked their queued calls failed, which flagged them with no way
forward). Now the switch says who is waiting and HR chooses: move them on to an interview,
or send them back to Resume Screening to be decided again.
"""

from __future__ import annotations

import logging
import uuid
from types import SimpleNamespace
from typing import Callable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import get_tenant_job
from app.exceptions import NotFoundError, ValidationError
from app.models.models import Candidate, Job, ScreeningCall, ShortlistResult, User
from app.schemas.schemas import (
    VoiceScreeningCandidate,
    VoiceScreeningChange,
    VoiceScreeningChangeResult,
    VoiceScreeningPreview,
)
from app.services.audit_service import AuditService
from app.services.screening_defaults import get_default_screening_questions
from app.services.candidate_contact_service import resolve_candidate_name
from app.services.screening_trigger_service import LIVE_CALL_STATUSES
from app.services.shortlist_stage_service import (
    PHONE_ROUND_STATES,
    load_stages,
    resolve_shortlist_stage,
)

logger = logging.getLogger(__name__)

# Up to this many are moved inside the request, so HR sees each result. More than that
# would hold the request for one email per candidate, so the rest go in the background.
INLINE_LIMIT = 10
CANCELLED_BY_SWITCH = "Cancelled: voice screening was turned off for this job."
BYPASS_SUMMARY = "Voice screening was turned off; moved straight to the interview."


async def classify_candidates(db: AsyncSession, job: Job, tenant_id: uuid.UUID) -> VoiceScreeningPreview:
    """Sort the job's approved candidates by what the switch would mean for them."""
    from app.services.settings_service import load_system_settings

    approved = list(
        (
            await db.execute(
                select(ShortlistResult.candidate_id).where(
                    ShortlistResult.job_id == job.id, ShortlistResult.hr_decision == "approved"
                )
            )
        )
        .scalars()
        .all()
    )
    preview = VoiceScreeningPreview(enabled=bool(job.voice_screening_enabled))
    if not approved:
        return preview
    candidates = {
        c.id: c
        for c in (await db.execute(select(Candidate).where(Candidate.id.in_(approved)))).scalars().all()
    }
    inputs = await load_stages(db, job.id, approved)
    settings = await load_system_settings(db, tenant_id=tenant_id)
    for candidate_id in approved:
        calls, sessions, has_report = inputs.get(candidate_id, ([], [], False))
        candidate = candidates.get(candidate_id)
        # Classified as if screening were on: the question is where they are in the phone
        # round, whatever the switch says now.
        stage = resolve_shortlist_stage(
            "approved",
            calls,
            sessions,
            has_report=has_report,
            phone=candidate.phone if candidate else None,
            settings=settings,
            screening_effective=True,
        )
        if stage is None:
            continue
        if stage.kind == "interview":
            preview.in_interviews += 1
        elif stage.state == "live":
            preview.live_calls += 1
        elif stage.state in PHONE_ROUND_STATES:
            preview.in_phone_round.append(
                VoiceScreeningCandidate(
                    candidate_id=candidate_id,
                    name=resolve_candidate_name(candidate) if candidate else "Candidate",
                    state=stage.state,
                )
            )
        else:  # review / failed: the call has a result for HR to act on
            preview.with_call_result += 1
    preview.in_phone_round.sort(key=lambda c: c.name.lower())
    return preview


class VoiceScreeningService:
    def __init__(self, session: AsyncSession, *, audit_service: AuditService | None = None) -> None:
        self._session = session
        self._audit = audit_service or AuditService(session)

    async def preview(self, actor: User, job_id: uuid.UUID) -> VoiceScreeningPreview:
        job = await get_tenant_job(self._session, job_id, actor.tenant_id)
        return await classify_candidates(self._session, job, actor.tenant_id)

    async def change(
        self,
        actor: User,
        job_id: uuid.UUID,
        body: VoiceScreeningChange,
        *,
        run_later: Optional[Callable[..., None]] = None,
    ) -> VoiceScreeningChangeResult:
        # Locked so two people flipping the switch at once take turns, and each sees the
        # candidates as the other left them.
        job = (
            await self._session.execute(
                select(Job)
                .where(Job.id == job_id, Job.tenant_id == actor.tenant_id)
                # NO KEY UPDATE, not UPDATE: inserting any row that references the job
                # (a screening call, an interview session) takes KEY SHARE on it, which plain
                # FOR UPDATE blocks. With a move to interviews running at the same time,
                # that turned into a deadlock against the per-candidate locks.
                # (SQLAlchemy spells FOR NO KEY UPDATE as key_share=True.)
                .with_for_update(key_share=True)
                .execution_options(populate_existing=True)
            )
        ).scalars().first()
        if job is None:
            raise NotFoundError(public_message="Job not found")
        preview = await classify_candidates(self._session, job, actor.tenant_id)
        waiting = preview.in_phone_round if not body.enabled else []
        if waiting and body.move_to is None:
            raise ValidationError(
                public_message=(
                    f"{len(waiting)} candidate{'s are' if len(waiting) != 1 else ' is'} waiting in the "
                    "phone round. Choose whether they move to Interviews or back to Resume Screening."
                )
            )
        move_to = body.move_to if waiting else None
        if body.enabled and not job.voice_screening_enabled and not job.screening_questions:
            # The calls would use these defaults anyway; saving them makes the job say so
            # (and is what the Edit modal already shows for a job with none).
            job.screening_questions = get_default_screening_questions(job.title or "")

        before = bool(job.voice_screening_enabled)
        job.voice_screening_enabled = body.enabled
        if before != body.enabled:
            await self._audit.log_field_changes(
                actor=actor,
                action="job.updated",
                entity_type="job",
                entity_id=job.id,
                subject_label=job.title,
                changes={"voice_screening_enabled": (before, body.enabled)},
                job_id=job.id,
            )

        moved_ids: list[VoiceScreeningCandidate] = []
        went_live = 0
        for item in waiting:
            # Same lock order as everything else that touches a candidate's round (the
            # decision endpoint, cancelling a call, moving to interview): the shortlist row
            # first, then their calls. Mixed orders deadlock when two of them overlap.
            row = await self._lock_still_waiting(job.id, item.candidate_id)
            if row is None:
                continue  # placed meanwhile (another run moved them, or they were decided)
            if not await self._cancel_queued_calls(job.id, item.candidate_id):
                went_live += 1  # a call went live between the preview and now: leave it running
                continue
            moved_ids.append(item)
            if move_to == "resume":
                await self._return_to_resume(actor, job, item, row)

        # Turning back on: anyone whose retry was skipped while it was off has no call on its
        # way, and the periodic dispatcher only looks at candidates never called. Queue theirs.
        redial: list[uuid.UUID] = []
        if body.enabled and not before:
            redial = [c.candidate_id for c in preview.in_phone_round if c.state == "retrying"]

        await self._session.commit()

        if redial:
            await self._resume_skipped_retries(job.id, redial)

        result = VoiceScreeningChangeResult(
            enabled=body.enabled,
            move_to=move_to,
            live_calls=preview.live_calls + went_live,
        )
        if move_to == "resume":
            result.moved = len(moved_ids)
        elif move_to == "interview":
            who = _snapshot(actor)
            job_id = job.id  # read now: a failed move rolls the session back, expiring `job`
            now_items, later_items = moved_ids, []
            if run_later is not None and len(moved_ids) > INLINE_LIMIT:
                now_items, later_items = moved_ids[:INLINE_LIMIT], moved_ids[INLINE_LIMIT:]
            await advance_to_interview(self._session, who, job_id, now_items, result)
            if later_items:
                result.in_background = len(later_items)
                run_later(advance_in_background, who, job_id, later_items)
        return result

    async def _resume_skipped_retries(self, job_id: uuid.UUID, candidate_ids: list[uuid.UUID]) -> None:
        """Schedule the retry that was skipped while screening was off, through the normal
        retry path: it keeps the attempt count, respects the maximum, and waits for the
        call window."""
        from app.tasks.screening_tasks import _schedule_retry

        for candidate_id in candidate_ids:
            last = (
                await self._session.execute(
                    select(ScreeningCall)
                    .where(ScreeningCall.job_id == job_id, ScreeningCall.candidate_id == candidate_id)
                    .order_by(ScreeningCall.created_at.desc())
                    .limit(1)
                )
            ).scalars().first()
            if last is None or last.call_status != "completed":
                continue
            try:
                await _schedule_retry(self._session, last)
                await self._session.commit()
            except Exception:  # noqa: BLE001 - the switch has already changed; log and go on
                logger.exception("Could not reschedule the call for candidate=%s", candidate_id)
                await self._session.rollback()

    async def _cancel_queued_calls(self, job_id: uuid.UUID, candidate_id: uuid.UUID) -> bool:
        """Cancel the candidate's undialled calls. False if a call is live (leave it be)."""
        calls = list(
            (
                await self._session.execute(
                    select(ScreeningCall)
                    .where(ScreeningCall.job_id == job_id, ScreeningCall.candidate_id == candidate_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        if any(c.call_status in LIVE_CALL_STATUSES or (c.call_status == "pending" and c.vapi_call_id) for c in calls):
            return False
        for call in calls:
            if call.call_status == "pending":
                call.call_status = "cancelled"
                call.summary = CANCELLED_BY_SWITCH
        return True

    async def _lock_still_waiting(self, job_id: uuid.UUID, candidate_id: uuid.UUID) -> ShortlistResult | None:
        """Lock the candidate's shortlist row and check they are still approved with no
        interview. A run that was moving them holds this lock until it is done, so we see
        its outcome rather than act on the preview we took before it."""
        from app.services.interview_session_service import get_active_interview_session

        row = (
            await self._session.execute(
                select(ShortlistResult)
                .where(ShortlistResult.job_id == job_id, ShortlistResult.candidate_id == candidate_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().first()
        if row is None or row.hr_decision != "approved":
            return None
        if await get_active_interview_session(self._session, candidate_id=candidate_id, job_id=job_id):
            return None
        return row

    async def _return_to_resume(
        self, actor: User, job: Job, item: VoiceScreeningCandidate, row: ShortlistResult
    ) -> None:
        row.hr_decision = "pending"
        await self._audit.log_change(
            actor=actor,
            action="shortlist.returned_to_resume",
            entity_type="shortlist",
            entity_id=row.id,
            subject_label=item.name,
            feature="hr_decision",
            before={"hr_decision": "approved"},
            after={"hr_decision": "pending", "reason": "voice_screening_turned_off"},
            job_id=job.id,
            candidate_id=item.candidate_id,
        )


def _snapshot(actor: User) -> SimpleNamespace:
    """The fields an audit row needs, as plain values. A rollback expires ORM objects, and
    reading an expired one in async code raises, so the loop below must not hold any."""
    return SimpleNamespace(id=actor.id, tenant_id=actor.tenant_id, full_name=actor.full_name, role=actor.role)


async def advance_to_interview(
    db: AsyncSession,
    actor: SimpleNamespace,
    job_id: uuid.UUID,
    items: list[VoiceScreeningCandidate],
    result: VoiceScreeningChangeResult,
) -> None:
    """One candidate at a time, each committed on its own: a failure partway leaves the
    rest done, and whoever could not be moved is still waiting, so the switch offers them
    again."""
    from app.services.interview_session_service import get_active_interview_session
    from app.services.interview_skip_screening_service import advance_approved_candidate_to_interview

    audit = AuditService(db)
    for item in items:
        try:
            # The job lock was released when the switch committed, so take the candidate's
            # own shortlist row: a second run (another HR user, "Place them", the background
            # half) waits here, then finds the interview already set up and leaves it.
            row = (
                await db.execute(
                    select(ShortlistResult)
                    .where(ShortlistResult.job_id == job_id, ShortlistResult.candidate_id == item.candidate_id)
                    .with_for_update()
                    # Re-read, not the copy this session may already hold: another run may
                    # have returned them to Resume Screening while we waited for the lock.
                    .execution_options(populate_existing=True)
                )
            ).scalars().first()
            if row is None or row.hr_decision != "approved" or await get_active_interview_session(
                db, candidate_id=item.candidate_id, job_id=job_id
            ):
                await db.commit()  # release the lock; someone else placed them
                continue
            advance = await advance_approved_candidate_to_interview(
                db, candidate_id=item.candidate_id, job_id=job_id, bypass_summary=BYPASS_SUMMARY
            )
        except Exception:  # noqa: BLE001 - reported per candidate, the others still go
            logger.exception("Could not move candidate=%s to interview", item.candidate_id)
            await db.rollback()
            result.failed.append(item.name)
            continue
        if advance.session_id is None:
            # The bypass "pass" was saved but no session was created: they show in the
            # Interviews tab without a link. Reported as not moved, so HR follows it up.
            result.failed.append(item.name)
            continue
        result.moved += 1
        if advance.email_sent:
            result.links_sent += 1
        elif advance.email_skipped_reason:
            result.email_failed.append(item.name)
        if advance.created:
            await audit.log_change(
                actor=actor,
                action="interview.link_sent",
                entity_type="interview",
                entity_id=advance.session_id,
                subject_label=item.name,
                feature="interview_link",
                before=None,
                after={"status": "pending", "reason": "voice_screening_turned_off", "email_sent": advance.email_sent},
                job_id=job_id,
                candidate_id=item.candidate_id,
            )
            await db.commit()


async def advance_in_background(
    actor: SimpleNamespace, job_id: uuid.UUID, items: list[VoiceScreeningCandidate]
) -> None:
    """The same work after the response has gone, on a session of its own."""
    from app.core.database import AsyncSessionLocal

    result = VoiceScreeningChangeResult(enabled=False)
    async with AsyncSessionLocal() as db:
        await advance_to_interview(db, actor, job_id, items, result)
    logger.info(
        "Voice screening off for job=%s: moved %d in the background (links=%d, email failed=%d, failed=%d)",
        job_id,
        result.moved,
        result.links_sent,
        len(result.email_failed),
        len(result.failed),
    )
