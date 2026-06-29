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
    Receive Vapi.ai call-end webhooks.

    Vapi sends JSON with: call.id, call.status, artifact.transcript, artifact.summary
    Finds ScreeningCall by vapi_call_id and enqueues processing task.
    Returns immediately — Vapi requires fast response.
    """
    from app.tasks.screening_tasks import process_screening_webhook as _process_task

    body: Dict[str, Any] = await request.json()

    call_data = body.get("call", {})
    vapi_call_id = call_data.get("id")

    if vapi_call_id:
        # Check if we have this call in the DB
        result = await db.execute(
            select(ScreeningCall).where(ScreeningCall.vapi_call_id == vapi_call_id)
        )
        screening_call = result.scalars().first()

        if screening_call:
            # Enqueue background processing — don't block the response
            _process_task.delay(body)
        else:
            # Log but still return 200 — Vapi may retry on non-200
            import logging
            logging.getLogger(__name__).warning(
                "Vapi webhook: no ScreeningCall found for vapi_call_id=%s", vapi_call_id
            )

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
