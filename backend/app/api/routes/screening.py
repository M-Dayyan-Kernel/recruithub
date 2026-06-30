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
from app.schemas.schemas import ScreeningCallResponse
from app.services.phone_validation import validate_phone

router = APIRouter()


# ---------------------------------------------------------------------------
# 5.1 — Screening trigger endpoint
# ---------------------------------------------------------------------------

@router.post("/jobs/{job_id}/screening/trigger", status_code=status.HTTP_202_ACCEPTED)
async def trigger_screening(
    job_id: uuid.UUID,
    body: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger AI voice screening for a list of approved shortlisted candidates.

    Body: { "candidate_ids": ["uuid", ...] }
    Returns: { "initiated": N, "skipped": [{"name": ..., "reason": ...}] }
    """
    # Import here to avoid circular imports at task discovery
    from app.core.celery_app import celery_app  # noqa: F401 — ensure task is discoverable
    from app.tasks.screening_tasks import initiate_screening_call  # noqa: F401

    candidate_ids_raw: List[str] = body.get("candidate_ids", [])
    if not candidate_ids_raw:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="candidate_ids is required and must be a non-empty list.",
        )

    # Validate job exists
    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    initiated = 0
    skipped = []
    new_screening_call_ids = []

    for raw_id in candidate_ids_raw:
        try:
            cand_uuid = uuid.UUID(str(raw_id))
        except (ValueError, AttributeError):
            skipped.append({"id": str(raw_id), "reason": "Invalid UUID format"})
            continue

        # Load candidate
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

        # Validate hr_decision = "approved" in shortlist_results
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

        # Validate phone number — skip instead of aborting entire request
        if not candidate.phone:
            skipped.append({"name": candidate.name, "reason": "No phone number on file"})
            continue

        is_valid, normalized_phone = validate_phone(candidate.phone)
        if not is_valid:
            skipped.append({"name": candidate.name, "reason": f"Invalid phone number: {candidate.phone}"})
            continue

        # Update candidate phone to normalized E.164
        candidate.phone = normalized_phone

        # Create ScreeningCall record
        screening_call_id = uuid.uuid4()
        screening_call = ScreeningCall(
            id=screening_call_id,
            candidate_id=cand_uuid,
            job_id=job_id,
            call_status="pending",
        )
        db.add(screening_call)
        new_screening_call_ids.append(screening_call_id)
        initiated += 1

    await db.commit()  # commit all records first so IDs exist in DB

    # Enqueue Celery tasks AFTER commit
    from app.tasks.screening_tasks import initiate_screening_call as _task
    for sc_id in new_screening_call_ids:
        _task.delay(str(sc_id))

    return {
        "initiated": initiated,
        "skipped": skipped,
    }


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

    # Live status updates while the call is ringing / in progress
    if message_type == "status-update":
        status_value = (message.get("status") or call_data.get("status") or "").lower()
        if status_value in ("ringing", "in-progress", "forwarding"):
            screening_call.call_status = "in_progress"
            await db.commit()
        elif status_value in ("ended", "completed"):
            _process_task.delay(body)
        return {"status": "received"}

    # End-of-call report — full transcript + summary processing
    if message_type in ("end-of-call-report", "call-ended"):
        _process_task.delay(body)
        return {"status": "received"}

    # Legacy / dashboard webhook shape — process on any call-end payload
    if call_data.get("status", "").lower() == "ended" or body.get("artifact"):
        _process_task.delay(body)
        return {"status": "received"}

    # Unknown event — poll Vapi as a safety net
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
    """
    Return all ScreeningCall records for a job, ordered by created_at desc.
    """
    # Validate job exists
    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    result = await db.execute(
        select(ScreeningCall)
        .where(ScreeningCall.job_id == job_id)
        .order_by(ScreeningCall.created_at.desc())
    )
    calls = result.scalars().all()
    return calls
