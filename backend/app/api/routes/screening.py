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
from app.core.deps import RequireAdminOrHr, hr_roles
from app.core.tenancy import get_tenant_job, get_tenant_screening_call
from app.models.models import Candidate, InterviewSession, ScreeningCall
from app.schemas.schemas import (
    ScreeningCallResponse,
    ScreeningResultUpdate,
    ScreeningTriggerRequest,
    ScreeningTriggerResponse,
)
from app.services.audit_service import log_change
from app.services.celery_health import CELERY_UNAVAILABLE_MSG, celery_workers_available
from app.services.screening_trigger_service import dispatch_screening_for_candidates

_hr_auth = Depends(hr_roles)

router = APIRouter()

LIVE_CALL_STATUSES = ("initiated", "in_progress")


def _screening_call_response(
    call: ScreeningCall,
    *,
    has_interview_session: bool = False,
) -> ScreeningCallResponse:
    response = ScreeningCallResponse.model_validate(call)
    response.has_interview_session = has_interview_session
    return response


async def _candidate_ids_with_interview_sessions(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> set[uuid.UUID]:
    result = await db.execute(
        select(InterviewSession.candidate_id).where(InterviewSession.job_id == job_id)
    )
    return set(result.scalars().all())


# ---------------------------------------------------------------------------
# 5.1 — Screening trigger endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/jobs/{job_id}/screening/trigger",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ScreeningTriggerResponse,
    dependencies=[_hr_auth],
)
async def trigger_screening(
    job_id: uuid.UUID,
    body: ScreeningTriggerRequest,
    actor: RequireAdminOrHr,
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

    if not celery_workers_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=CELERY_UNAVAILABLE_MSG,
        )

    from app.services.settings_service import load_system_settings

    job = await get_tenant_job(db, job_id, actor.tenant_id)
    system_settings = await load_system_settings(db, tenant_id=job.tenant_id)
    if not system_settings.screening_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Voice screening is disabled in system settings",
        )

    parsed_ids: list[uuid.UUID] = []
    skipped: List[dict] = []
    for raw_id in body.candidate_ids:
        try:
            parsed_ids.append(uuid.UUID(str(raw_id)))
        except (ValueError, AttributeError):
            skipped.append({"id": str(raw_id), "reason": "Invalid UUID format"})

    initiated, queued, dispatch_skipped = await dispatch_screening_for_candidates(
        db,
        job,
        parsed_ids,
        force=body.force,
    )
    skipped.extend(dispatch_skipped)

    await log_change(
        db,
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
    await db.commit()

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
        ended_reason = message.get("endedReason") or call_data.get("endedReason")
        artifact = message.get("artifact") or call_data.get("artifact") or {}
        transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""
        ended_at = call_data.get("endedAt") or message.get("endedAt")
        started_at = call_data.get("startedAt") or message.get("startedAt")

        if status_value in ("ringing", "in-progress", "forwarding", "queued", "scheduled"):
            screening_call.call_status = "in_progress"
            await db.commit()
            return {"status": "received"}

        if status_value in ("ended", "completed", "failed", "busy", "no-answer") or ended_at:
            from app.tasks.screening_tasks import (
                TRANSCRIPT_ENRICH_DELAY_SEC,
                enrich_screening_transcript as _enrich_task,
                should_wait_for_transcript,
            )

            needs_transcript_wait = should_wait_for_transcript(
                transcript=transcript,
                started_at=started_at,
                ended_reason=ended_reason,
                call_status=screening_call.call_status,
            )
            await apply_screening_call_end(
                db,
                screening_call,
                ended_reason=ended_reason,
                transcript=transcript,
                schedule_retry=not needs_transcript_wait and not transcript.strip(),
                send_failure_email=not needs_transcript_wait,
                awaiting_transcript=needs_transcript_wait,
            )
            if (
                transcript.strip()
                and len(transcript.strip()) >= 50
                and not needs_transcript_wait
            ):
                _process_task.delay(body)
            elif needs_transcript_wait:
                _enrich_task.apply_async(
                    args=[str(screening_call.id), 0],
                    countdown=TRANSCRIPT_ENRICH_DELAY_SEC,
                )
            elif transcript.strip():
                # Thin transcript still processing — enrich may recover fuller artifact.
                _enrich_task.apply_async(
                    args=[str(screening_call.id), 0],
                    countdown=TRANSCRIPT_ENRICH_DELAY_SEC,
                )
            return {"status": "received"}

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
        started_at = call_data.get("startedAt") or message.get("startedAt")
        from app.tasks.screening_tasks import (
            TRANSCRIPT_ENRICH_DELAY_SEC,
            enrich_screening_transcript as _enrich_task,
            should_wait_for_transcript,
        )

        needs_transcript_wait = should_wait_for_transcript(
            transcript=transcript,
            started_at=started_at,
            ended_reason=ended_reason,
            call_status=screening_call.call_status,
        )
        await apply_screening_call_end(
            db,
            screening_call,
            ended_reason=ended_reason,
            transcript=transcript,
            schedule_retry=not needs_transcript_wait and not transcript.strip(),
            send_failure_email=not needs_transcript_wait,
            awaiting_transcript=needs_transcript_wait,
        )
        if (
            transcript.strip()
            and len(transcript.strip()) >= 50
            and not needs_transcript_wait
        ):
            _process_task.delay(body)
        elif needs_transcript_wait or transcript.strip():
            _enrich_task.apply_async(
                args=[str(screening_call.id), 0],
                countdown=TRANSCRIPT_ENRICH_DELAY_SEC,
            )
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
        started_at = call_data.get("startedAt") or message.get("startedAt")
        from app.tasks.screening_tasks import (
            TRANSCRIPT_ENRICH_DELAY_SEC,
            enrich_screening_transcript as _enrich_task,
            should_wait_for_transcript,
        )

        needs_transcript_wait = should_wait_for_transcript(
            transcript=transcript,
            started_at=started_at,
            ended_reason=ended_reason,
            call_status=screening_call.call_status,
        )
        await apply_screening_call_end(
            db,
            screening_call,
            ended_reason=ended_reason,
            transcript=transcript,
            schedule_retry=not needs_transcript_wait and not transcript.strip(),
            send_failure_email=not needs_transcript_wait,
            awaiting_transcript=needs_transcript_wait,
        )
        if (
            transcript.strip()
            and len(transcript.strip()) >= 50
            and not needs_transcript_wait
        ):
            _process_task.delay(body)
        elif needs_transcript_wait or transcript.strip():
            _enrich_task.apply_async(
                args=[str(screening_call.id), 0],
                countdown=TRANSCRIPT_ENRICH_DELAY_SEC,
            )
        return {"status": "received"}

    _sync_task.delay(str(screening_call.id))
    return {"status": "received"}


# ---------------------------------------------------------------------------
# 5.3 — Screening results endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}/screening",
    response_model=List[ScreeningCallResponse],
    dependencies=[_hr_auth],
)
async def get_screening_results(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Return all ScreeningCall records for a job, ordered by created_at desc."""
    import asyncio
    import logging

    from app.tasks.screening_tasks import (
        refresh_live_screening_calls_from_vapi,
        sync_screening_call_status,
    )

    logger = logging.getLogger(__name__)

    await get_tenant_job(db, job_id, actor.tenant_id)

    result = await db.execute(
        select(ScreeningCall)
        .where(ScreeningCall.job_id == job_id)
        .order_by(ScreeningCall.created_at.desc())
    )
    calls = list(result.scalars().all())

    live_ids = [
        str(call.id)
        for call in calls
        if call.call_status in LIVE_CALL_STATUSES and call.vapi_call_id
    ]
    if live_ids:
        try:
            refreshed = await asyncio.wait_for(
                refresh_live_screening_calls_from_vapi(db, calls),
                timeout=5.0,
            )
        except TimeoutError:
            logger.warning(
                "Timed out refreshing live screening calls for job %s", job_id
            )
            refreshed = False
            for screening_call_id in live_ids:
                sync_screening_call_status.apply_async(
                    args=[screening_call_id],
                    countdown=0,
                )
        else:
            if refreshed:
                result = await db.execute(
                    select(ScreeningCall)
                    .where(ScreeningCall.job_id == job_id)
                    .order_by(ScreeningCall.created_at.desc())
                )
                calls = list(result.scalars().all())

    interview_candidate_ids = await _candidate_ids_with_interview_sessions(db, job_id)
    return [
        _screening_call_response(
            call,
            has_interview_session=call.candidate_id in interview_candidate_ids,
        )
        for call in calls
    ]


@router.post(
    "/screening/{screening_id}/refresh",
    response_model=ScreeningCallResponse,
    dependencies=[_hr_auth],
)
async def refresh_screening_call(
    screening_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Poll Vapi for one in-flight screening call and return the latest DB state."""
    from app.tasks.screening_tasks import refresh_screening_call_from_vapi

    screening_call = await get_tenant_screening_call(db, screening_id, actor.tenant_id)

    if screening_call.call_status in LIVE_CALL_STATUSES and screening_call.vapi_call_id:
        await refresh_screening_call_from_vapi(db, screening_call)
        screening_call = await get_tenant_screening_call(db, screening_id, actor.tenant_id)

    interview_candidate_ids = await _candidate_ids_with_interview_sessions(
        db, screening_call.job_id
    )
    return _screening_call_response(
        screening_call,
        has_interview_session=screening_call.candidate_id in interview_candidate_ids,
    )


# ---------------------------------------------------------------------------
# 5.4 — HR screening result decision
# ---------------------------------------------------------------------------

@router.patch(
    "/screening/{screening_id}/result",
    response_model=ScreeningCallResponse,
    dependencies=[_hr_auth],
)
async def update_screening_result(
    screening_id: uuid.UUID,
    payload: ScreeningResultUpdate,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Set HR decision on a completed screening call."""
    valid_results = {"pass", "fail", "needs_review"}
    if payload.result not in valid_results:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"result must be one of: {', '.join(sorted(valid_results))}",
        )

    screening_call = await get_tenant_screening_call(db, screening_id, actor.tenant_id)

    if screening_call.call_status != "completed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Screening result can only be set after the call is completed.",
        )

    before_result = screening_call.result
    screening_call.result = payload.result
    if payload.result != "pass":
        screening_call.interview_queued_at = None

    candidate = await db.get(Candidate, screening_call.candidate_id)
    subject = (candidate.name if candidate and candidate.name else None) or str(
        screening_call.candidate_id
    )
    await log_change(
        db,
        actor=actor,
        action="screening.result_set",
        entity_type="screening",
        entity_id=screening_call.id,
        subject_label=subject,
        feature="result",
        before={"result": before_result},
        after={"result": payload.result},
        job_id=screening_call.job_id,
    )
    await db.commit()
    await db.refresh(screening_call)

    interview_candidate_ids = await _candidate_ids_with_interview_sessions(
        db, screening_call.job_id
    )
    return _screening_call_response(
        screening_call,
        has_interview_session=screening_call.candidate_id in interview_candidate_ids,
    )
