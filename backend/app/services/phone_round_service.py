"""
Move a candidate out of the phone round by hand: on to an interview without the call, or
rejected.

For a candidate the call could not settle (no answer after every attempt, declined, no
phone number, a call HR cancelled), the Phone screening tab used to have nothing beyond
"Call Now", and nothing at all when there was no number to call. These are the two ways
forward. A call with a result is decided from the result instead (pass / fail / review).
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import get_tenant_candidate, get_tenant_job
from app.exceptions import ConflictError
from app.models.models import InterviewSession, ScreeningCall, ShortlistResult, User
from app.schemas.schemas import PhoneRoundActionResponse
from app.services.audit_service import AuditService
from app.services.candidate_contact_service import resolve_candidate_name
from app.services.screening_trigger_service import call_is_on_its_way, cancel_undialled_calls
from app.services.shortlist_stage_service import PHONE_ROUND_STATES, resolve_shortlist_stage

logger = logging.getLogger(__name__)

# Waiting in the phone round with no call result, with screening on or off.
_PLACEABLE_STATES = PHONE_ROUND_STATES | {"paused"}


class PhoneRoundService:
    def __init__(self, session: AsyncSession, *, audit_service: AuditService | None = None) -> None:
        self._session = session
        self._audit = audit_service or AuditService(session)

    async def _lock(self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID):
        """Lock the candidate (shortlist row, then calls: the order every path uses), and
        check nothing is on its way and no call has settled them. Returns the locked rows
        and the stage state the action applies to."""
        from app.services.settings_service import load_system_settings

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
        if row is None or row.hr_decision != "approved":
            raise ConflictError(public_message="This candidate is not in the phone round.")

        sessions = list(
            (
                await self._session.execute(
                    select(InterviewSession).where(
                        InterviewSession.job_id == job.id, InterviewSession.candidate_id == candidate_id
                    )
                )
            )
            .scalars()
            .all()
        )
        if sessions:
            # Checked before locking the calls: an interview means the phone round is behind
            # them, and the refusal should not hold up a dial meanwhile.
            raise ConflictError(public_message="This candidate is already in the Interviews stage.")

        calls = list(
            (
                await self._session.execute(
                    select(ScreeningCall)
                    .where(ScreeningCall.job_id == job.id, ScreeningCall.candidate_id == candidate_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        if any(call_is_on_its_way(c) for c in calls):
            raise ConflictError(public_message="A call is in progress for this candidate. Wait for it to end.")

        settings = await load_system_settings(self._session, tenant_id=actor.tenant_id)
        from app.services.screening_gate_service import is_voice_screening_effective

        stage = resolve_shortlist_stage(
            "approved",
            calls,
            sessions,  # none: refused above
            phone=candidate.phone,
            settings=settings,
            screening_effective=is_voice_screening_effective(settings, job),
        )
        if stage is None or stage.kind != "screening" or stage.state not in _PLACEABLE_STATES:
            if stage is not None and stage.kind == "interview":
                raise ConflictError(public_message="This candidate is already in the Interviews stage.")
            raise ConflictError(
                public_message="This candidate's call has a result. Decide from the result instead."
            )
        return job, candidate, row, calls, stage.state

    async def advance(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID, reason: str
    ) -> PhoneRoundActionResponse:
        """Skip the call: a bypass "pass" (carrying the reason), an interview link, the email."""
        from app.services.interview_skip_screening_service import advance_approved_candidate_to_interview

        job, candidate, row, calls, state = await self._lock(actor, job_id, candidate_id)
        name = resolve_candidate_name(candidate)
        cancel_undialled_calls(calls, "Cancelled: moved to interview without a call.")
        # Written now, so it is committed together with the move (the bypass record, the
        # session) by the first commit inside it: there is no moment where the move exists
        # without its reason.
        await self._audit.log_change(
            actor=actor,
            action="screening.advanced_without_call",
            entity_type="shortlist",
            entity_id=row.id,
            subject_label=name,
            feature="phone_round",
            before={"state": state},
            after={"reason": reason},
            job_id=job.id,
            candidate_id=candidate_id,
        )
        advance = await advance_approved_candidate_to_interview(
            self._session,
            candidate_id=candidate_id,
            job_id=job.id,
            bypass_summary=f"Moved to interview without a screening call by {actor.full_name}: {reason}",
            # Its own record, newer than this round's calls: it carries the reason, and both
            # tabs then read the candidate as passed rather than as the round they left.
            reuse_existing_pass=False,
        )
        # session_id is None only if the session could not be created; the bypass is saved,
        # so they show in the Interviews tab with "Send link", and email_sent is False.
        return PhoneRoundActionResponse(
            candidate_id=candidate_id,
            interview_session_id=advance.session_id,
            email_sent=advance.email_sent,
        )

    async def reject(self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID) -> PhoneRoundActionResponse:
        """Reject from the phone round: queued calls cancelled, decision rejected, one email.
        Approving them again from Resume Screening starts a fresh call."""
        from app.services.shortlist_service import ShortlistService

        job, candidate, row, calls, state = await self._lock(actor, job_id, candidate_id)
        name = resolve_candidate_name(candidate)
        cancel_undialled_calls(calls, "Cancelled: candidate rejected in Phone screening.")
        row.hr_decision = "rejected"
        await self._audit.log_change(
            actor=actor,
            action="screening.rejected",
            entity_type="shortlist",
            entity_id=row.id,
            subject_label=name,
            feature="hr_decision",
            before={"hr_decision": "approved", "state": state},
            after={"hr_decision": "rejected"},
            job_id=job.id,
            candidate_id=candidate_id,
        )
        # Saved before the email: a slow or failing mail server must not undo it.
        await self._session.commit()
        try:
            email_sent = await ShortlistService(self._session).send_rejection_email(actor, row, row.id, candidate)
        except Exception:  # noqa: BLE001 - the rejection stands; HR is told the email did not go
            logger.exception("Rejection email failed for candidate=%s", candidate_id)
            email_sent = False
        return PhoneRoundActionResponse(candidate_id=candidate_id, email_sent=email_sent)
