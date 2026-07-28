"""
Screening trigger — create ScreeningCall records and enqueue Vapi dials.
"""

from __future__ import annotations

import logging
import uuid
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import get_tenant_job
from app.models.models import Candidate, Job, ScreeningCall, ShortlistResult, User
from app.schemas.schemas import ScreeningTriggerRequest, ScreeningTriggerResponse
from app.services.audit_service import AuditService
from app.services.phone_validation import validate_phone_with_reason
from app.services.screening_dispatch_service import enqueue_screening_call

logger = logging.getLogger(__name__)

LIVE_CALL_STATUSES = ("initiated", "in_progress")


async def candidate_has_live_call(
    db: AsyncSession,
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> bool:
    result = await db.execute(
        select(ScreeningCall.id).where(
            ScreeningCall.job_id == job_id,
            ScreeningCall.candidate_id == candidate_id,
            ScreeningCall.call_status.in_(LIVE_CALL_STATUSES),
        )
    )
    return result.scalar_one_or_none() is not None


async def find_scheduled_pending_call(
    db: AsyncSession,
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> ScreeningCall | None:
    result = await db.execute(
        select(ScreeningCall)
        .where(
            ScreeningCall.job_id == job_id,
            ScreeningCall.candidate_id == candidate_id,
            ScreeningCall.call_status == "pending",
            ScreeningCall.vapi_call_id.is_(None),
        )
        .order_by(ScreeningCall.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def candidate_has_any_screening_call(
    db: AsyncSession,
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> bool:
    result = await db.execute(
        select(ScreeningCall.id).where(
            ScreeningCall.job_id == job_id,
            ScreeningCall.candidate_id == candidate_id,
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def find_unqueued_approved_candidate_ids(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> list[uuid.UUID]:
    """Approved shortlist candidates with a phone number and no screening call yet."""
    called_subq = (
        select(ScreeningCall.candidate_id)
        .where(ScreeningCall.job_id == job_id)
        .distinct()
    )
    result = await db.execute(
        select(ShortlistResult.candidate_id)
        .join(Candidate, Candidate.id == ShortlistResult.candidate_id)
        .where(
            ShortlistResult.job_id == job_id,
            ShortlistResult.hr_decision == "approved",
            Candidate.phone.isnot(None),
            Candidate.phone != "",
            ~ShortlistResult.candidate_id.in_(called_subq),
        )
    )
    return list(result.scalars().all())


async def dispatch_screening_for_candidates(
    db: AsyncSession,
    job: Job,
    candidate_ids: list[uuid.UUID],
    *,
    force: bool = False,
) -> tuple[int, int, list[dict]]:
    """
    Create ScreeningCall rows (when needed) and enqueue Celery dial tasks.

    Returns (initiated, queued, skipped).
    """
    from app.services.screening_gate_service import screening_disabled_reason
    from app.services.settings_service import load_system_settings

    system_settings = await load_system_settings(db, tenant_id=job.tenant_id)
    disabled_reason = screening_disabled_reason(system_settings, job)
    if disabled_reason:
        return 0, 0, [{"reason": disabled_reason}]

    initiated = 0
    queued = 0
    skipped: list[dict] = []
    dispatch_queue: list[tuple[uuid.UUID, bool]] = []

    for cand_uuid in candidate_ids:
        cand_result = await db.execute(
            select(Candidate).where(
                Candidate.id == cand_uuid,
                Candidate.job_id == job.id,
            )
        )
        candidate = cand_result.scalars().first()
        if not candidate:
            skipped.append({"id": str(cand_uuid), "reason": "Candidate not found in this job"})
            continue

        shortlist_result = await db.execute(
            select(ShortlistResult).where(
                ShortlistResult.candidate_id == cand_uuid,
                ShortlistResult.job_id == job.id,
            )
        )
        shortlist = shortlist_result.scalars().first()
        if not shortlist or shortlist.hr_decision != "approved":
            decision = shortlist.hr_decision if shortlist else "not_shortlisted"
            skipped.append({
                "name": candidate.name,
                "reason": f"Candidate is not HR-approved (current decision: {decision})",
            })
            continue

        if await candidate_has_live_call(db, job.id, cand_uuid):
            skipped.append({
                "name": candidate.name,
                "reason": "A screening call is already in progress for this candidate",
            })
            continue

        scheduled = await find_scheduled_pending_call(db, job.id, cand_uuid)
        if scheduled:
            dispatch_queue.append((scheduled.id, force))
            continue

        if not candidate.phone:
            skipped.append({"name": candidate.name, "reason": "No phone number on file"})
            continue

        is_valid, normalized_phone, reject_reason = await validate_phone_with_reason(
            candidate.phone,
            session=db,
            tenant_id=job.tenant_id,
        )
        if not is_valid:
            skipped.append({
                "name": candidate.name,
                "reason": reject_reason or f"Invalid phone number: {candidate.phone}",
            })
            continue

        candidate.phone = normalized_phone

        screening_call_id = uuid.uuid4()
        screening_call = ScreeningCall(
            id=screening_call_id,
            candidate_id=cand_uuid,
            job_id=job.id,
            call_status="pending",
        )
        db.add(screening_call)
        dispatch_queue.append((screening_call_id, force))

    if dispatch_queue:
        await db.commit()

        for sc_id, dial_force in dispatch_queue:
            immediate = enqueue_screening_call(sc_id, job, force=dial_force)
            if immediate:
                initiated += 1
            else:
                queued += 1

    return initiated, queued, skipped


async def auto_dispatch_unqueued_approved_for_job(
    db: AsyncSession,
    job: Job,
    *,
    force: bool = False,
) -> tuple[int, int]:
    """Dial approved candidates who have never been screened yet."""
    candidate_ids = await find_unqueued_approved_candidate_ids(db, job.id)
    if not candidate_ids:
        return 0, 0

    initiated, queued, skipped = await dispatch_screening_for_candidates(
        db,
        job,
        candidate_ids,
        force=force,
    )
    if initiated or queued:
        logger.info(
            "auto_dispatch job=%s initiated=%d queued=%d skipped=%d",
            job.id,
            initiated,
            queued,
            len(skipped),
        )
    return initiated, queued


class ScreeningTriggerService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        audit_service: AuditService | None = None,
    ) -> None:
        self._session = session
        self._audit = audit_service or AuditService(session)

    async def trigger(
        self,
        actor: User,
        job_id: uuid.UUID,
        body: ScreeningTriggerRequest,
    ) -> ScreeningTriggerResponse:
        from app.core.celery_queues import SCREENING_QUEUE
        from app.services.celery_health import (
            celery_queue_available_async,
            celery_queue_unavailable_message,
        )
        from app.services.screening_gate_service import screening_disabled_reason
        from app.services.settings_service import load_system_settings
        from app.exceptions import (
            EmptyCandidateIdsError,
            ScreeningDisabledError,
            ScreeningUnavailableError,
        )

        if not body.candidate_ids:
            raise EmptyCandidateIdsError()

        if not await celery_queue_available_async(SCREENING_QUEUE):
            raise ScreeningUnavailableError(
                public_message=celery_queue_unavailable_message(SCREENING_QUEUE),
            )

        job = await get_tenant_job(self._session, job_id, actor.tenant_id)
        system_settings = await load_system_settings(self._session, tenant_id=job.tenant_id)
        disabled_reason = screening_disabled_reason(system_settings, job)
        if disabled_reason:
            raise ScreeningDisabledError(public_message=disabled_reason)

        parsed_ids: list[uuid.UUID] = []
        skipped: list[dict] = []
        for raw_id in body.candidate_ids:
            try:
                parsed_ids.append(uuid.UUID(str(raw_id)))
            except (ValueError, AttributeError):
                skipped.append({"id": str(raw_id), "reason": "Invalid UUID format"})

        initiated, queued, dispatch_skipped = await dispatch_screening_for_candidates(
            self._session,
            job,
            parsed_ids,
            force=body.force,
        )
        skipped.extend(dispatch_skipped)

        await self._audit.log_change(
            actor=actor,
            action="screening.triggered",
            entity_type="job",
            entity_id=job_id,
            subject_label=job.title,
            feature="screening",
            before=None,
            after={
                "initiated": initiated,
                "queued": queued,
                "candidate_ids": [str(i) for i in parsed_ids],
            },
            job_id=job_id,
        )
        await self._session.commit()

        return ScreeningTriggerResponse(
            initiated=initiated,
            queued=queued,
            skipped=skipped,
        )
