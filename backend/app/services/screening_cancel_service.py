"""
Cancel a queued screening call.

Only a call that has not been dialled can be cancelled here: one that is ringing or in
conversation is on a live Vapi call, which needs a different action (ending it).
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import get_tenant_candidate, get_tenant_job
from app.exceptions import ConflictError
from app.models.models import ScreeningCall, ShortlistResult, User
from app.schemas.schemas import ScreeningCancelResponse
from app.services.audit_service import AuditService
from app.services.candidate_contact_service import resolve_candidate_name
from app.services.screening_trigger_service import LIVE_CALL_STATUSES

logger = logging.getLogger(__name__)

CANCELLED_SUMMARY = "Cancelled by HR before the call was placed."


class ScreeningCancelService:
    def __init__(self, session: AsyncSession, *, audit_service: AuditService | None = None) -> None:
        self._session = session
        self._audit = audit_service or AuditService(session)

    async def cancel(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> ScreeningCancelResponse:
        """
        Cancel the candidate's queued or scheduled call. They stay in the phone round, and
        "Call Now" starts a new call whenever HR wants one.

        A candidate who is approved but has not been dialled yet has no call to cancel, so
        a cancelled one is recorded: without it, the auto-dispatch that places a call for
        every approved candidate without one would simply make the call anyway. Dispatch that
        starts after the cancel respects it; one already midway through creating a call
        (it takes no lock) can still slip a call in beside the marker.
        """
        from app.services.screening_gate_service import is_voice_screening_effective
        from app.services.settings_service import load_system_settings

        job = await get_tenant_job(self._session, job_id, actor.tenant_id)
        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)
        if candidate.job_id != job.id:
            raise ConflictError(public_message="This candidate does not belong to this job.")

        settings = await load_system_settings(self._session, tenant_id=actor.tenant_id)
        if not is_voice_screening_effective(settings, job):
            raise ConflictError(public_message="Voice screening is turned off for this job.")

        # Locked, like a decision change: it serialises two cancels of one candidate (a double
        # click would otherwise record two markers) when there is no call row to lock yet.
        approved = (
            await self._session.execute(
                select(ShortlistResult.id)
                .where(
                    ShortlistResult.job_id == job.id,
                    ShortlistResult.candidate_id == candidate_id,
                    ShortlistResult.hr_decision == "approved",
                )
                .with_for_update()
            )
        ).scalars().first()
        if approved is None:
            raise ConflictError(public_message="This candidate is not in the phone round.")

        # Locked: a dial that has just started holds its row until it has recorded the call,
        # and we must see the result of that rather than cancel underneath it.
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

        if any(c.call_status in LIVE_CALL_STATUSES for c in calls) or any(
            c.call_status == "pending" and c.vapi_call_id for c in calls
        ):
            raise ConflictError(
                public_message="A call is in progress for this candidate, so it cannot be cancelled here."
            )

        queued = [c for c in calls if c.call_status == "pending" and not c.vapi_call_id]
        if queued:
            for call in queued:
                call.call_status = "cancelled"
                call.summary = CANCELLED_SUMMARY
            first = queued[0]
            before_status: str | None = "pending"
            cancelled = len(queued)
        elif not calls:
            first = ScreeningCall(
                candidate_id=candidate_id,
                job_id=job.id,
                call_status="cancelled",
                summary=CANCELLED_SUMMARY,
            )
            self._session.add(first)
            await self._session.flush()
            before_status = None
            cancelled = 1
        elif max(calls, key=lambda c: c.created_at).call_status == "cancelled":
            raise ConflictError(public_message="The call has already been cancelled.")
        else:
            raise ConflictError(public_message="There is no queued call to cancel for this candidate.")

        await self._audit.log_change(
            actor=actor,
            action="screening.call_cancelled",
            entity_type="screening",
            entity_id=first.id,
            subject_label=resolve_candidate_name(candidate),
            feature="call_status",
            before={"call_status": before_status},
            after={"call_status": "cancelled"},
            job_id=job.id,
            candidate_id=candidate_id,
        )
        await self._session.commit()
        logger.info("%s cancelled the queued screening call for candidate=%s", actor.id, candidate_id)
        return ScreeningCancelResponse(candidate_id=candidate_id, cancelled=cancelled)
