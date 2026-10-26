"""The Rejected stage: reject, reconsider, and tell the candidate.

Rejecting moves a candidate out of whichever stage they were in and into one place, the
Rejected list. It is reversible (Reconsider) until the candidate has been emailed, and
emailing happens only from that list, so a rejection never reaches a candidate by accident.

`ShortlistResult.hr_decision == 'rejected'` is the marker; the other columns say where
from, who, when, whether they were told, and what Reconsider restores.

Lock order, as everywhere: the shortlist row, then the calls, then the interview sessions.
Holding them is what makes "nothing is live" a fact rather than a race: a call that is
dialled or an interview that starts meanwhile waits for this transaction and then finds a
rejected candidate.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import get_tenant_candidate, get_tenant_job
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.models.models import (
    Candidate,
    InterviewReport,
    InterviewSession,
    ScreeningCall,
    ShortlistResult,
    User,
)
from app.schemas.schemas import (
    ReconsiderResponse,
    RejectedCandidate,
    RejectedListResponse,
    RejectionEmailResponse,
    RejectionEmailResult,
    RejectResponse,
)
from app.services.audit_service import AuditService
from app.services.candidate_contact_service import resolve_candidate_email, resolve_candidate_name
from app.core.screening_skipped import is_skipped_call
from app.services.live_work_guard import interview_is_live
from app.services.screening_trigger_service import call_is_on_its_way, cancel_undialled_calls
from app.services.shortlist_stage_service import is_successful_call

logger = logging.getLogger(__name__)

# An email attempt that died between claim and result leaves a claim behind. Past this it
# is treated as abandoned: a retry may send, and Reconsider is allowed again.
CLAIM_STALE_AFTER = timedelta(minutes=10)

# What Reconsider restores for a phone rejection.
_PHONE_COMPLETED = "phone_completed"  # a call finished: back to its result, no redial
_PHONE_FAILED = "phone_failed"  # the call result was "fail": back to "needs review"
_INTERVIEW = "interview"
_RESUME_OVERRIDDEN = "resume_overridden"  # HR had overridden the AI's call: restore that, not "pending"

_ERASED_EMAIL_SUFFIX = "@erased.local"


def _usable_email(candidate: Candidate | None) -> str | None:
    email = resolve_candidate_email(candidate)
    if not email or email.endswith(_ERASED_EMAIL_SUFFIX):
        return None
    return email


def _reached_calls(calls: list[ScreeningCall]) -> list[ScreeningCall]:
    """Calls that really reached the candidate, newest first. A skipped screening is a
    record that no call happened, so it never decides what Reconsider restores."""
    return [c for c in calls if is_successful_call(c) and not is_skipped_call(c)]


def _claim_is_fresh(row: ShortlistResult, now: datetime) -> bool:
    claimed = row.rejection_email_claimed_at
    return claimed is not None and claimed > now - CLAIM_STALE_AFTER


class RejectService:
    def __init__(self, session: AsyncSession, *, audit_service: AuditService | None = None) -> None:
        self._session = session
        self._audit = audit_service or AuditService(session)

    async def _lock(self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID):
        job = await get_tenant_job(self._session, job_id, actor.tenant_id)
        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)
        if candidate.job_id != job.id:
            raise ConflictError(public_message="This candidate does not belong to this job.")
        row = (
            await self._session.execute(
                select(ShortlistResult)
                .where(ShortlistResult.job_id == job.id, ShortlistResult.candidate_id == candidate_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().first()
        calls = list(
            (
                await self._session.execute(
                    select(ScreeningCall)
                    .where(ScreeningCall.job_id == job.id, ScreeningCall.candidate_id == candidate_id)
                    .order_by(ScreeningCall.created_at.desc())
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalars().all()
        )
        sessions = list(
            (
                await self._session.execute(
                    select(InterviewSession)
                    .where(InterviewSession.job_id == job.id, InterviewSession.candidate_id == candidate_id)
                    .order_by(InterviewSession.created_at.desc())
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalars().all()
        )
        return job, candidate, row, calls, sessions

    async def _refuse(self, message: str):
        # Nothing was changed yet: end the transaction so the row locks are released, then
        # refuse. Commit rather than rollback, which would expire the request's objects.
        await self._session.commit()
        raise ConflictError(public_message=message)

    # -- reject ----------------------------------------------------------------------

    async def reject(self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID) -> RejectResponse:
        """Move the candidate to Rejected from wherever they are. Unstarted calls and links
        are cancelled; a call or interview that is live is never stopped, so this is refused
        until it ends. No email: that is sent from the Rejected list."""
        job, candidate, row, calls, sessions = await self._lock(actor, job_id, candidate_id)
        if row is None:
            await self._refuse("Score the candidate against the job before rejecting them.")
        if row.hr_decision == "rejected":
            await self._session.commit()
            return RejectResponse(
                candidate_id=candidate_id, rejected_from=row.rejected_from or "resume", changed=False
            )

        latest_session = sessions[0] if sessions else None
        if latest_session is not None and latest_session.hr_decision == "approved":
            await self._refuse("This candidate is a finalist and can no longer be rejected from here.")
        if any(call_is_on_its_way(c) for c in calls):
            await self._refuse("A call is in progress for this candidate. Wait for it to end.")
        if any(interview_is_live(s) for s in sessions):
            await self._refuse("This candidate is in an interview right now. Wait for it to end.")

        if latest_session is not None:
            origin = "interview"
        elif row.hr_decision == "approved":
            origin = "phone"
        else:
            origin = "resume"

        reconsider_state = None
        if origin == "interview":
            reconsider_state = _INTERVIEW
        elif origin == "phone":
            reached = _reached_calls(calls)
            if reached:
                reconsider_state = _PHONE_FAILED if reached[0].result == "fail" else _PHONE_COMPLETED
        elif row.hr_decision == "overridden":
            reconsider_state = _RESUME_OVERRIDDEN

        before = row.hr_decision
        cancel_undialled_calls(calls, "Cancelled: candidate rejected.")
        if latest_session is not None:
            if latest_session.status == "pending":
                # Safe under the row locks above: the candidate cannot open the link between
                # the check and this. It is only a pending link that has not yet lapsed.
                from app.services.interview_cancel_service import cancel_pending_session

                try:
                    await cancel_pending_session(self._session, candidate_id=candidate_id, job_id=job.id)
                except (NotFoundError, ConflictError):
                    pass  # lapsed already: nothing left to cancel
            latest_session.hr_decision = "rejected"

        now = datetime.now(timezone.utc)
        row.hr_decision = "rejected"
        row.rejected_from = origin
        row.rejected_at = now
        row.rejected_by = actor.id
        row.rejection_email_claimed_at = None
        row.rejection_emailed_at = None
        row.reconsider_state = reconsider_state

        await self._audit.log_change(
            actor=actor,
            action="shortlist.rejected",
            entity_type="shortlist",
            entity_id=row.id,
            subject_label=resolve_candidate_name(candidate),
            feature="hr_decision",
            before={"hr_decision": before},
            after={"hr_decision": "rejected", "rejected_from": origin},
            job_id=job.id,
            candidate_id=candidate_id,
        )
        await self._session.commit()
        return RejectResponse(candidate_id=candidate_id, rejected_from=origin)

    # -- reconsider ------------------------------------------------------------------

    async def reconsider(self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID) -> ReconsiderResponse:
        """Put a rejected candidate back where they were rejected from. Refused once they
        have been emailed (or an email is being sent): telling them is final."""
        job, candidate, row, calls, sessions = await self._lock(actor, job_id, candidate_id)
        if row is None or row.hr_decision != "rejected":
            await self._refuse("This candidate is not rejected.")
        now = datetime.now(timezone.utc)
        if row.rejection_emailed_at is not None:
            await self._refuse("This candidate has already been emailed, so the rejection is final.")
        if _claim_is_fresh(row, now):
            await self._refuse("A rejection email is being sent to this candidate. Try again in a moment.")

        origin = row.rejected_from or "resume"
        state = row.reconsider_state
        redial = False
        if origin == "resume":
            row.hr_decision = "overridden" if state == _RESUME_OVERRIDDEN else "pending"
        else:
            row.hr_decision = "approved"
            if origin == "phone":
                if state == _PHONE_FAILED:
                    # Back to "needs review" so HR decides again, rather than a redial.
                    reached = _reached_calls(calls)
                    if reached:
                        reached[0].result = "needs_review"
                elif state != _PHONE_COMPLETED:
                    redial = True  # rejected before any call finished: a fresh call
            elif sessions:
                sessions[0].hr_decision = "pending"

        row.rejected_from = None
        row.rejected_at = None
        row.rejected_by = None
        row.rejection_email_claimed_at = None
        row.reconsider_state = None
        if (candidate.status or "").lower() == "rejected":
            candidate.status = "active"

        await self._audit.log_change(
            actor=actor,
            action="shortlist.reconsidered",
            entity_type="shortlist",
            entity_id=row.id,
            subject_label=resolve_candidate_name(candidate),
            feature="hr_decision",
            before={"hr_decision": "rejected", "rejected_from": origin},
            after={"hr_decision": row.hr_decision},
            job_id=job.id,
            candidate_id=candidate_id,
        )
        await self._session.commit()

        if redial:
            # Same as approving them again: a fresh call (or, with screening off, the move
            # to an interview). Saved first; a failure here leaves them in the phone round
            # where Call Now is available.
            from app.services.shortlist_service import ShortlistService

            try:
                await ShortlistService(self._session)._handle_approval_side_effects(actor, row)
            except Exception:  # noqa: BLE001 - the reconsider stands
                logger.exception("Dispatch after reconsider failed for candidate=%s", candidate_id)
        return ReconsiderResponse(candidate_id=candidate_id, restored_to=origin)

    # -- the list ----------------------------------------------------------------------

    async def list_rejected(self, actor: User, job_id: uuid.UUID) -> RejectedListResponse:
        job = await get_tenant_job(self._session, job_id, actor.tenant_id)
        rows = (
            await self._session.execute(
                select(ShortlistResult, Candidate)
                .join(Candidate, Candidate.id == ShortlistResult.candidate_id)
                .where(ShortlistResult.job_id == job.id, ShortlistResult.hr_decision == "rejected")
                .order_by(ShortlistResult.rejected_at.desc().nullslast(), ShortlistResult.created_at.desc())
            )
        ).all()
        if not rows:
            return RejectedListResponse(candidates=[])

        candidate_ids = [c.id for _, c in rows]
        actor_ids = {r.rejected_by for r, _ in rows if r.rejected_by}
        names = {}
        if actor_ids:
            names = dict(
                (
                    await self._session.execute(select(User.id, User.full_name).where(User.id.in_(actor_ids)))
                ).all()
            )
        latest_session: dict[uuid.UUID, uuid.UUID] = {}
        for sid, cid in (
            await self._session.execute(
                select(InterviewSession.id, InterviewSession.candidate_id)
                .where(InterviewSession.job_id == job.id, InterviewSession.candidate_id.in_(candidate_ids))
                .order_by(InterviewSession.created_at.asc())
            )
        ).all():
            latest_session[cid] = sid  # ascending, so the last one wins
        with_report = set(
            (
                await self._session.execute(
                    select(InterviewReport.interview_session_id).where(
                        InterviewReport.interview_session_id.in_(list(latest_session.values()))
                    )
                )
            ).scalars().all()
        ) if latest_session else set()

        now = datetime.now(timezone.utc)
        out: list[RejectedCandidate] = []
        for row, candidate in rows:
            emailed = row.rejection_emailed_at is not None
            sending = not emailed and _claim_is_fresh(row, now)
            email = _usable_email(candidate)
            sid = latest_session.get(candidate.id)
            out.append(
                RejectedCandidate(
                    candidate_id=candidate.id,
                    candidate_name=resolve_candidate_name(candidate),
                    candidate_email=email,
                    rejected_from=row.rejected_from,
                    rejected_at=row.rejected_at,
                    rejected_by_name=names.get(row.rejected_by),
                    email_state="emailed" if emailed else ("sending" if sending else "not_told"),
                    emailed_at=row.rejection_emailed_at,
                    can_email=email is not None,
                    can_reconsider=not emailed and not sending,
                    has_report=sid in with_report if sid else False,
                )
            )
        return RejectedListResponse(candidates=out)

    # -- telling the candidate ---------------------------------------------------------

    async def send_rejection_emails(
        self, actor: User, job_id: uuid.UUID, candidate_ids: list[uuid.UUID]
    ) -> RejectionEmailResponse:
        """Email the rejected candidates in `candidate_ids` (at most ten per request, so a
        request stays short). Each one is claimed atomically and in its own transaction:
        two people clicking at once, or a retry, cannot send the same candidate two emails,
        and one failure does not touch the rest."""
        if len(candidate_ids) > 10:
            raise ValidationError(public_message="Send at most 10 emails per request.")
        job = await get_tenant_job(self._session, job_id, actor.tenant_id)
        results: list[RejectionEmailResult] = []
        for candidate_id in dict.fromkeys(candidate_ids):
            try:
                status = await self._send_one(actor, job.id, candidate_id)
            except Exception:  # noqa: BLE001 - report it, keep the earlier results
                logger.exception("Rejection email step failed for candidate=%s", candidate_id)
                await self._session.rollback()
                status = "failed"
            results.append(RejectionEmailResult(candidate_id=candidate_id, status=status))
        return RejectionEmailResponse(
            results=results,
            sent=sum(1 for r in results if r.status == "sent"),
            failed=sum(1 for r in results if r.status == "failed"),
        )

    async def _send_one(self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID) -> str:
        from app.services.shortlist_service import ShortlistService

        now = datetime.now(timezone.utc)
        claimed = (
            await self._session.execute(
                update(ShortlistResult)
                .where(
                    ShortlistResult.job_id == job_id,
                    ShortlistResult.candidate_id == candidate_id,
                    ShortlistResult.hr_decision == "rejected",
                    ShortlistResult.rejection_emailed_at.is_(None),
                    (ShortlistResult.rejection_email_claimed_at.is_(None))
                    | (ShortlistResult.rejection_email_claimed_at < now - CLAIM_STALE_AFTER),
                )
                .values(rejection_email_claimed_at=now)
                .returning(ShortlistResult.id)
            )
        ).scalars().first()
        # Committed before the send: the claim is what the next request sees, and a slow
        # mail server must not hold a row lock.
        await self._session.commit()
        if claimed is None:
            return "skipped"

        candidate = None
        sent = False
        try:
            row = await self._session.get(ShortlistResult, claimed, populate_existing=True)
            candidate = await self._session.get(Candidate, candidate_id)
            if _usable_email(candidate) is None:
                await self._release_claim(claimed)
                return "no_email"
            sent = await ShortlistService(self._session).send_rejection_email(actor, row, row.id, candidate)
        except Exception:  # noqa: BLE001 - one candidate must not stop the rest
            logger.exception("Rejection email failed for candidate=%s", candidate_id)
        if not sent:
            await self._release_claim(claimed)
            return "failed"

        # The email has gone: recording it is what makes it final. If the first write fails,
        # try once more rather than leave a told candidate looking not told (and so
        # emailable again once the claim lapses).
        for attempt in (1, 2):
            try:
                await self._mark_emailed(actor, claimed, job_id, candidate_id, candidate)
                break
            except Exception:  # noqa: BLE001
                await self._session.rollback()
                logger.exception(
                    "Rejection email sent but not recorded (attempt %s) for candidate=%s", attempt, candidate_id
                )
        return "sent"

    async def _mark_emailed(self, actor, shortlist_id, job_id, candidate_id, candidate) -> None:
        await self._session.execute(
            update(ShortlistResult)
            .where(ShortlistResult.id == shortlist_id)
            .values(rejection_emailed_at=datetime.now(timezone.utc))
        )
        await self._audit.log_change(
            actor=actor,
            action="shortlist.rejection_emailed",
            entity_type="shortlist",
            entity_id=shortlist_id,
            subject_label=resolve_candidate_name(candidate),
            feature="rejection_email",
            before=None,
            after={"emailed": True},
            job_id=job_id,
            candidate_id=candidate_id,
        )
        await self._session.commit()

    async def _release_claim(self, shortlist_id: uuid.UUID) -> None:
        await self._session.rollback()  # a failed step may have left the transaction broken
        await self._session.execute(
            update(ShortlistResult)
            .where(ShortlistResult.id == shortlist_id, ShortlistResult.rejection_emailed_at.is_(None))
            .values(rejection_email_claimed_at=None)
        )
        await self._session.commit()
