"""
Screening Routes — Sprint 5

Endpoints:
  POST /api/jobs/{job_id}/screening/trigger — trigger screening for approved candidates
  POST /api/screening/webhook               — Vapi.ai call-end webhook (no auth)
  GET  /api/jobs/{job_id}/screening         — list all screening calls for a job
"""

import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import Candidate, Job, ScreeningCall, ShortlistResult
from app.schemas.schemas import (
    ScreeningCallResponse,
    ScreeningResultUpdate,
    ScreeningTriggerRequest,
    ScreeningTriggerResponse,
)
from app.services.phone_validation import validate_phone_with_reason
from app.services.screening_dispatch_service import enqueue_screening_call

router = APIRouter()

LIVE_CALL_STATUSES = ("initiated", "in_progress")


async def _candidate_has_live_call(
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


async def _find_scheduled_pending_call(
    db: AsyncSession,
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
) -> ScreeningCall | None:
    """Return a queued retry waiting for Celery (pending, no Vapi id yet)."""
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


# ---------------------------------------------------------------------------
# 5.1 — Screening trigger endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/jobs/{job_id}/screening/trigger",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ScreeningTriggerResponse,
)
async def trigger_screening(
    job_id: uuid.UUID,
    body: ScreeningTriggerRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger AI voice screening for a list of approved shortlisted candidates.

    Body: { "candidate_ids": ["uuid", ...], "force": false }
    Returns: { "initiated": N, "queued": M, "skipped": [...] }
    """
    if not body.candidate_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="candidate_ids is required and must be a non-empty list.",
        )

    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    initiated = 0
    queued = 0
    skipped: List[dict] = []
    dispatch_queue: List[tuple[uuid.UUID, bool]] = []

    for raw_id in body.candidate_ids:
        try:
            cand_uuid = uuid.UUID(str(raw_id))
        except (ValueError, AttributeError):
            skipped.append({"id": str(raw_id), "reason": "Invalid UUID format"})
            continue

        cand_result = await db.execute(
            select(Candidate).where(
                Candidate.id == cand_uuid,
                Candidate.job_id == job_id,
            )
        )
        candidate = cand_result.scalars().first()
        if not candidate:
            skipped.append({"id": str(cand_uuid), "reason": "Candidate not found in this job"})
            continue

        shortlist_result = await db.execute(
            select(ShortlistResult).where(
                ShortlistResult.candidate_id == cand_uuid,
                ShortlistResult.job_id == job_id,
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

        if await _candidate_has_live_call(db, job_id, cand_uuid):
            skipped.append({
                "name": candidate.name,
                "reason": "A screening call is already in progress for this candidate",
            })
            continue

        scheduled = await _find_scheduled_pending_call(db, job_id, cand_uuid)
        if scheduled:
            dispatch_queue.append((scheduled.id, body.force))
            continue

        if not candidate.phone:
            skipped.append({"name": candidate.name, "reason": "No phone number on file"})
            continue

        is_valid, normalized_phone, reject_reason = await validate_phone_with_reason(
            candidate.phone
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
            job_id=job_id,
            call_status="pending",
        )
        db.add(screening_call)
        dispatch_queue.append((screening_call_id, body.force))

    await db.commit()

    for sc_id, force in dispatch_queue:
        immediate = enqueue_screening_call(sc_id, job, force=force)
        if immediate:
            initiated += 1
        else:
            queued += 1

    return ScreeningTriggerResponse(
        initiated=initiated,
        queued=queued,
        skipped=skipped,
    )


# ---------------------------------------------------------------------------
# 5.2 — Vapi webhook endpoint (no auth — Vapi doesn't send auth headers)
# ---------------------------------------------------------------------------

@router.post("/screening/webhook", status_code=status.HTTP_200_OK)
async def vapi_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Receive Vapi.ai server URL events (status updates, end-of-call reports).

    Finds ScreeningCall by vapi_call_id and enqueues processing or updates status.
    Returns immediately — Vapi requires fast response.
    """
    import logging

    from app.tasks.screening_tasks import (
        apply_screening_call_end,
        process_screening_webhook as _process_task,
        sync_screening_call_status as _sync_task,
    )

    logger = logging.getLogger(__name__)
    body: Dict[str, Any] = await request.json()

    message = body.get("message") or {}
    message_type = message.get("type") or body.get("type")

    call_data = body.get("call") or message.get("call") or {}
    vapi_call_id = call_data.get("id")

    if not vapi_call_id:
        return {"status": "received"}

    result = await db.execute(
        select(ScreeningCall).where(ScreeningCall.vapi_call_id == vapi_call_id)
    )
    screening_call = result.scalars().first()

    if not screening_call:
        logger.warning(
            "Vapi webhook: no ScreeningCall found for vapi_call_id=%s", vapi_call_id
        )
        return {"status": "received"}

    if message_type == "status-update":
        status_value = (message.get("status") or call_data.get("status") or "").lower()
        if status_value in ("ringing", "in-progress", "forwarding"):
            screening_call.call_status = "in_progress"
            await db.commit()
        elif status_value in ("ended", "completed"):
            ended_reason = message.get("endedReason") or call_data.get("endedReason")
            artifact = message.get("artifact") or call_data.get("artifact") or {}
            transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""
            await apply_screening_call_end(
                db,
                screening_call,
                ended_reason=ended_reason,
                transcript=transcript,
                schedule_retry=not transcript.strip(),
            )
            if transcript.strip():
                _process_task.delay(body)
        return {"status": "received"}

    if message_type in ("end-of-call-report", "call-ended"):
        ended_reason = message.get("endedReason") or call_data.get("endedReason")
        artifact = (
            body.get("artifact")
            or message.get("artifact")
            or call_data.get("artifact")
            or {}
        )
        transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""
        await apply_screening_call_end(
            db,
            screening_call,
            ended_reason=ended_reason,
            transcript=transcript,
            schedule_retry=not transcript.strip(),
        )
        if transcript.strip():
            _process_task.delay(body)
        return {"status": "received"}

    if call_data.get("status", "").lower() == "ended" or body.get("artifact"):
        ended_reason = message.get("endedReason") or call_data.get("endedReason")
        artifact = (
            body.get("artifact")
            or message.get("artifact")
            or call_data.get("artifact")
            or {}
        )
        transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""
        await apply_screening_call_end(
            db,
            screening_call,
            ended_reason=ended_reason,
            transcript=transcript,
            schedule_retry=not transcript.strip(),
        )
        if transcript.strip():
            _process_task.delay(body)
        return {"status": "received"}

    _sync_task.delay(str(screening_call.id))
    return {"status": "received"}


# ---------------------------------------------------------------------------
# 5.3 — Screening results endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}/screening",
    response_model=List[ScreeningCallResponse],
)
async def get_screening_results(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return all ScreeningCall records for a job, ordered by created_at desc."""
    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    result = await db.execute(
        select(ScreeningCall)
        .where(ScreeningCall.job_id == job_id)
        .order_by(ScreeningCall.created_at.desc())
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# 5.4 — HR screening result decision
# ---------------------------------------------------------------------------

@router.patch(
    "/screening/{screening_id}/result",
    response_model=ScreeningCallResponse,
)
async def update_screening_result(
    screening_id: uuid.UUID,
    payload: ScreeningResultUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Set HR decision on a completed screening call."""
    valid_results = {"pass", "fail", "needs_review"}
    if payload.result not in valid_results:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"result must be one of: {', '.join(sorted(valid_results))}",
        )

    call_result = await db.execute(
        select(ScreeningCall).where(ScreeningCall.id == screening_id)
    )
    screening_call = call_result.scalar_one_or_none()
    if not screening_call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening call not found",
        )

    if screening_call.call_status != "completed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Screening result can only be set after the call is completed.",
        )

    screening_call.result = payload.result
    await db.commit()
    await db.refresh(screening_call)
    return screening_call
