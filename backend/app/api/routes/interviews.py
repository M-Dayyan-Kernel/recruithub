"""
Interviews Router — Sprint 6

Endpoints for LiveKit interview session management:
  POST /api/candidates/{candidate_id}/interview/send      — create session + send email
  POST /api/candidates/{candidate_id}/interview/schedule — create session for a future slot
  POST /api/candidates/{candidate_id}/interview/mark-complete — HR force-complete → Completed tab
  GET  /api/interview/{token}                          — candidate fetches session details
  POST /api/interview/{token}/start                    — create LiveKit room, return token
  POST /api/interview/{token}/complete                 — mark complete + enqueue assessment
  POST /api/livekit/webhook                            — LiveKit room events
  GET  /api/candidates/{candidate_id}/report           — fetch interview report
"""

import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.core.config_loader import config
from app.core.deps import RequireAdminOrHr, hr_roles
from app.core.tenancy import get_tenant_candidate, get_tenant_job
from app.models.models import (
    Candidate,
    InterviewSession,
    InterviewReport,
    ScreeningCall,
)
from app.schemas.schemas import (
    InterviewSessionResponse,
    InterviewStartResponse,
    InterviewReportResponse,
    InterviewPipelineResponse,
    InterviewScheduleRequest,
    InterviewHrDecisionUpdate,
    FinalistsResponse,
)
from app.services.audit_service import log_change

_hr_auth = Depends(hr_roles)

router = APIRouter()
logger = logging.getLogger(__name__)


async def _apply_interview_capacity_fields(
    response_data: InterviewSessionResponse,
    db: AsyncSession,
) -> None:
    """Set capacity hints for pending sessions (candidate landing pre-check)."""
    if response_data.status != "pending":
        return

    from app.services.interview_queue_service import (
        busy_retry_minutes,
        has_live_interview_slot,
    )

    available = await has_live_interview_slot(db)
    response_data.capacity_available = available
    if not available:
        response_data.retry_after_minutes = busy_retry_minutes()


def _raise_interview_capacity_full() -> None:
    from app.services.interview_queue_service import busy_retry_minutes

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "code": "interview_capacity_full",
            "message": "All interviewers are currently busy. Please try again later.",
            "retry_after_minutes": busy_retry_minutes(),
        },
    )


async def _candidate_label(db: AsyncSession, candidate: Candidate | None, candidate_id: uuid.UUID) -> str:
    if candidate and candidate.name:
        return candidate.name
    if candidate and candidate.original_filename:
        return candidate.original_filename
    return str(candidate_id)


async def _get_latest_pass_screening_call(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
) -> ScreeningCall | None:
    result = await db.execute(
        select(ScreeningCall)
        .where(
            ScreeningCall.candidate_id == candidate_id,
            ScreeningCall.job_id == job_id,
            ScreeningCall.call_status == "completed",
            ScreeningCall.result == "pass",
        )
        .order_by(ScreeningCall.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def _mark_interview_queued(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
) -> ScreeningCall:
    screening_call = await _get_latest_pass_screening_call(db, candidate_id, job_id)
    if not screening_call:
        raise HTTPException(
            status_code=400,
            detail="Candidate has not passed screening. Cannot queue for interview.",
        )
    screening_call.interview_queued_at = datetime.now(timezone.utc)
    await db.flush()
    return screening_call


# ---------------------------------------------------------------------------
# POST /api/candidates/{candidate_id}/interview/queue
# ---------------------------------------------------------------------------

@router.post(
    "/candidates/{candidate_id}/interview/queue",
    status_code=status.HTTP_200_OK,
    dependencies=[_hr_auth],
)
async def queue_candidate_for_interview(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    HR action: add a passed screening candidate to the interview pipeline (Pending tab)
    without sending the interview link yet.
    """
    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    await _mark_interview_queued(db, candidate_id, candidate.job_id)
    await log_change(
        db,
        actor=actor,
        action="interview.queued",
        entity_type="interview",
        entity_id=candidate_id,
        subject_label=await _candidate_label(db, candidate, candidate_id),
        feature="interview_queue",
        before=None,
        after={"queued": True},
        job_id=candidate.job_id,
        candidate_id=candidate_id,
    )
    await db.commit()

    return {
        "message": "Candidate queued for interview",
        "candidate_id": str(candidate_id),
    }


# ---------------------------------------------------------------------------
# POST /api/candidates/{candidate_id}/interview/schedule
# ---------------------------------------------------------------------------

@router.post(
    "/candidates/{candidate_id}/interview/schedule",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_hr_auth],
)
async def schedule_interview(
    candidate_id: uuid.UUID,
    body: InterviewScheduleRequest,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    Create an interview session for a specific date/time.

    The candidate is emailed immediately with the interview link and the
    scheduled slot (not deferred until the slot arrives).
    """
    from app.models.models import Job
    from app.services.interview_schedule_service import (
        parse_scheduled_at,
        send_scheduled_interview_notification_email,
    )

    try:
        scheduled_at = parse_scheduled_at(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    if scheduled_at < now - timedelta(minutes=1):
        raise HTTPException(
            status_code=422,
            detail="Scheduled time must be in the future.",
        )

    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    if not await _get_latest_pass_screening_call(db, candidate_id, candidate.job_id):
        raise HTTPException(
            status_code=400,
            detail="Candidate has not passed screening. Interview cannot be scheduled.",
        )

    existing_result = await db.execute(
        select(InterviewSession).where(
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.job_id == candidate.job_id,
            InterviewSession.status.in_(["pending", "in_progress"]),
        )
    )
    if existing_result.scalars().first():
        raise HTTPException(
            status_code=409,
            detail="An active interview session already exists for this candidate.",
        )

    unique_token = str(uuid.uuid4())
    interview_session = InterviewSession(
        candidate_id=candidate_id,
        job_id=candidate.job_id,
        unique_token=unique_token,
        status="pending",
        scheduled_interview_at=scheduled_at,
        expires_at=scheduled_at + timedelta(days=config.interview.session_link_ttl_days),
    )
    db.add(interview_session)
    await db.flush()

    await _mark_interview_queued(db, candidate_id, candidate.job_id)

    job_result = await db.execute(select(Job).where(Job.id == candidate.job_id))
    job = job_result.scalars().first()
    job_title = job.title if job else "the position"

    interview_url = f"{config.CANDIDATE_APP_URL}/interview/{unique_token}"

    email_sent = await send_scheduled_interview_notification_email(
        db,
        interview_session,
        candidate,
        job_title,
        timezone_name=body.timezone or "Asia/Kolkata",
    )
    if not email_sent:
        logger.warning(
            "Interview scheduled for candidate=%s but notification email failed",
            candidate_id,
        )

    await log_change(
        db,
        actor=actor,
        action="interview.scheduled",
        entity_type="interview",
        entity_id=interview_session.id,
        subject_label=await _candidate_label(db, candidate, candidate_id),
        feature="scheduled_interview_at",
        before=None,
        after={"scheduled_interview_at": scheduled_at.isoformat()},
        job_id=candidate.job_id,
        candidate_id=candidate_id,
    )
    await db.commit()
    await db.refresh(interview_session)

    response_data = InterviewSessionResponse.model_validate(interview_session)
    response_data.interview_url = interview_url
    response_data.candidate_name = candidate.name
    response_data.job_title = job_title
    return response_data


# ---------------------------------------------------------------------------
# POST /api/candidates/{candidate_id}/interview/send
# ---------------------------------------------------------------------------

@router.post(
    "/candidates/{candidate_id}/interview/send",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_hr_auth],
)
async def send_interview_link(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    Create an InterviewSession and send the interview link to the candidate.

    Requires:
    - Candidate exists
    - A ScreeningCall with result='pass' exists for this candidate
    - No active (pending/in_progress) session already exists

    Email failure is non-fatal — session is still created and link is returned.
    """
    from app.models.models import Job
    from app.services.interview_schedule_service import send_interview_invitation_email
    from app.services.interview_session_service import create_pending_interview_session

    # Load candidate
    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    # Validate screening result = 'pass'
    screening_result = await db.execute(
        select(ScreeningCall).where(
            ScreeningCall.candidate_id == candidate_id,
            ScreeningCall.result == "pass",
        )
    )
    screening_call = screening_result.scalars().first()
    if not screening_call:
        raise HTTPException(
            status_code=400,
            detail="Candidate has not passed screening. Interview cannot be scheduled.",
        )

    try:
        interview_session, candidate, job_title = await create_pending_interview_session(
            db,
            candidate_id=candidate_id,
            job_id=candidate.job_id,
        )
    except ValueError as exc:
        detail = str(exc)
        if "already exists" in detail:
            raise HTTPException(status_code=409, detail=detail) from exc
        raise HTTPException(status_code=400, detail=detail) from exc

    await _mark_interview_queued(db, candidate_id, candidate.job_id)

    interview_url = f"{config.CANDIDATE_APP_URL}/interview/{interview_session.unique_token}"

    await send_interview_invitation_email(db, interview_session, candidate, job_title)

    await log_change(
        db,
        actor=actor,
        action="interview.link_sent",
        entity_type="interview",
        entity_id=interview_session.id,
        subject_label=await _candidate_label(db, candidate, candidate_id),
        feature="interview_link",
        before=None,
        after={"status": interview_session.status},
        job_id=candidate.job_id,
        candidate_id=candidate_id,
    )
    await db.commit()
    await db.refresh(interview_session)

    # Build response — add interview_url and candidate context fields
    response_data = InterviewSessionResponse.model_validate(interview_session)
    response_data.interview_url = interview_url
    response_data.candidate_name = candidate.name
    response_data.job_title = job_title

    return response_data


# ---------------------------------------------------------------------------
# GET /api/interview/{token}
# ---------------------------------------------------------------------------

@router.get("/interview/{token}", response_model=InterviewSessionResponse)
async def get_session_by_token(token: str, db: AsyncSession = Depends(get_db)):
    """Candidate app: fetch session details using the unique link token."""
    result = await db.execute(
        select(InterviewSession).where(InterviewSession.unique_token == token)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    # Enrich with candidate name and job title via joins
    from app.models.models import Candidate, Job

    candidate_result = await db.execute(
        select(Candidate).where(Candidate.id == session.candidate_id)
    )
    candidate = candidate_result.scalars().first()

    job_result = await db.execute(
        select(Job).where(Job.id == session.job_id)
    )
    job = job_result.scalars().first()

    # Check and apply link expiry (A-13)
    if session.expires_at and session.expires_at < datetime.now(timezone.utc):
        if session.status not in ("completed", "expired"):
            session.status = "expired"
            await db.commit()
            await db.refresh(session)

    response_data = InterviewSessionResponse.model_validate(session)
    response_data.candidate_name = candidate.name if candidate else None
    response_data.job_title = job.title if job else None

    from app.services.mock_external import mock_livekit_enabled

    response_data.mock_mode = mock_livekit_enabled()

    await _apply_interview_capacity_fields(response_data, db)

    return response_data


# ---------------------------------------------------------------------------
# POST /api/interview/{token}/start
# ---------------------------------------------------------------------------

@router.post("/interview/{token}/start", response_model=InterviewStartResponse)
async def start_interview(token: str, db: AsyncSession = Depends(get_db)):
    """
    Create a LiveKit room (first start) or return a fresh token (rejoin).

    - pending → creates room, dispatches AI agent, returns candidate token
    - in_progress → reissues candidate token for the existing room (rejoin)
    """
    from app.models.models import Job
    from app.services.interview_guards import (
        assert_session_joinable,
        enforce_public_interview_rate_limit,
    )
    from app.services.livekit_service import create_room, generate_candidate_token
    from app.services.tenant_integrations_service import load_tenant_integrations

    enforce_public_interview_rate_limit(token, "start")

    result = await db.execute(
        select(InterviewSession).where(InterviewSession.unique_token == token)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    if session.status == "completed":
        raise HTTPException(status_code=409, detail="Interview already completed.")
    if session.status == "expired":
        raise HTTPException(status_code=410, detail="Interview link has expired.")

    await assert_session_joinable(session, db)

    candidate_result = await db.execute(
        select(Candidate).where(Candidate.id == session.candidate_id)
    )
    candidate = candidate_result.scalars().first()
    candidate_name = candidate.name if candidate else "Candidate"

    job_result = await db.execute(select(Job).where(Job.id == session.job_id))
    job = job_result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found for this interview")

    try:
        integrations = await load_tenant_integrations(db, job.tenant_id)
        integrations.require("livekit_url", "livekit_api_key", "livekit_api_secret")
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    livekit_url = integrations.livekit_url
    if not (livekit_url or "").strip():
        raise HTTPException(
            status_code=503,
            detail="LiveKit URL is not configured for this tenant. Cannot start interview.",
        )

    # Rejoin — session already started, return a new access token
    if session.status == "in_progress" and session.livekit_room_name:
        try:
            candidate_token = generate_candidate_token(
                session.livekit_room_name, candidate_name, integrations
            )
        except Exception as exc:
            logger.error("Failed to generate rejoin token: %s", exc)
            raise HTTPException(
                status_code=502, detail=f"Failed to generate access token: {exc}"
            )
        logger.info(
            "Interview rejoin: session=%s room=%s candidate=%s",
            session.id,
            session.livekit_room_name,
            candidate_name,
        )
        return InterviewStartResponse(
            room_name=session.livekit_room_name,
            token=candidate_token,
            livekit_url=livekit_url,
        )

    if session.status != "pending":
        raise HTTPException(
            status_code=409,
            detail="Interview already started or not in pending state.",
        )

    from app.services.interview_queue_service import has_live_interview_slot

    if not await has_live_interview_slot(db):
        _raise_interview_capacity_full()

    # Room-first: create LiveKit room before durable in_progress commit
    room_name = f"interview-{session.id}"
    now = datetime.now(timezone.utc)
    egress_id: Optional[str] = None
    recording_key: Optional[str] = None

    try:
        _, egress_id, recording_key = await create_room(room_name, integrations)
        candidate_token = generate_candidate_token(room_name, candidate_name, integrations)
    except Exception as exc:
        logger.error("Failed to create LiveKit room/token %s: %s", room_name, exc)
        # Ensure session stays retryable
        await db.execute(
            update(InterviewSession)
            .where(
                InterviewSession.id == session.id,
                InterviewSession.status == "pending",
            )
            .values(livekit_room_name=None, egress_id=None, recording_key=None)
        )
        await db.commit()
        raise HTTPException(
            status_code=502, detail=f"Failed to create interview room: {exc}"
        ) from exc

    atomic = await db.execute(
        update(InterviewSession)
        .where(InterviewSession.unique_token == token, InterviewSession.status == "pending")
        .values(
            status="in_progress",
            started_at=now,
            livekit_room_name=room_name,
            egress_id=egress_id,
            recording_key=recording_key,
            recording_ready=False if egress_id else None,
        )
        .returning(InterviewSession.id)
    )
    updated = atomic.scalars().first()
    if not updated:
        # Lost race — another request claimed the session; try rejoin if possible
        await db.refresh(session)
        if session.status == "in_progress" and session.livekit_room_name:
            try:
                candidate_token = generate_candidate_token(
                    session.livekit_room_name, candidate_name, integrations
                )
            except Exception as exc:
                raise HTTPException(
                    status_code=502, detail=f"Failed to generate access token: {exc}"
                ) from exc
            return InterviewStartResponse(
                room_name=session.livekit_room_name,
                token=candidate_token,
                livekit_url=livekit_url,
            )
        raise HTTPException(
            status_code=409,
            detail="Interview already started or not in pending state.",
        )
    await db.commit()

    logger.info(
        "Interview started: session=%s room=%s candidate=%s",
        session.id,
        room_name,
        candidate_name,
    )

    return InterviewStartResponse(
        room_name=room_name,
        token=candidate_token,
        livekit_url=livekit_url,
    )


# ---------------------------------------------------------------------------
# POST /api/candidates/{candidate_id}/interview/mark-complete
# ---------------------------------------------------------------------------

_STUB_INTERVIEW_TRANSCRIPT = (
    "AI: Welcome to your technical interview. Let's begin.\n"
    "User: Sure, I'm ready.\n"
    "AI: Can you describe a recent project where you built a backend API?\n"
    "User: I built a FastAPI service with PostgreSQL, Celery workers for async jobs, "
    "and integrated OpenAI for document parsing. We handled about 10k requests per day.\n"
    "AI: How did you handle failures in background tasks?\n"
    "User: We used retries with exponential backoff in Celery and dead-letter logging.\n"
    "AI: Thank you. That concludes our interview.\n"
)


@router.post(
    "/candidates/{candidate_id}/interview/mark-complete",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[_hr_auth],
)
async def mark_interview_complete(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    HR action: force-complete a pending/in-progress interview so the candidate
    moves to the Completed pipeline tab (and assessment is generated).
    """
    from app.models.models import Job
    from app.services.interview_flag_service import has_meaningful_transcript
    from app.tasks.interview_tasks import generate_interview_report

    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    result = await db.execute(
        select(InterviewSession)
        .where(
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.job_id == candidate.job_id,
            InterviewSession.status.in_(["pending", "in_progress"]),
        )
        .order_by(InterviewSession.created_at.desc())
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(
            status_code=404,
            detail="No active interview session found to mark complete.",
        )

    now = datetime.now(timezone.utc)
    before_status = session.status
    session.status = "completed"
    session.completed_at = now
    if not session.started_at:
        session.started_at = now

    # Stub transcript only in mock mode — production leaves empty/thin transcript
    # so assessment soft-fails to needs_review.
    from app.services.mock_external import mock_livekit_enabled

    if not has_meaningful_transcript(session.transcript) and mock_livekit_enabled():
        session.transcript = _STUB_INTERVIEW_TRANSCRIPT

    await log_change(
        db,
        actor=actor,
        action="interview.mark_complete",
        entity_type="interview_session",
        entity_id=session.id,
        subject_label=await _candidate_label(db, candidate, candidate_id),
        job_id=candidate.job_id,
        candidate_id=candidate_id,
        feature="status",
        before={"status": before_status},
        after={"status": "completed"},
    )
    await db.commit()
    await db.refresh(session)

    try:
        generate_interview_report.delay(str(session.id))
    except Exception as exc:
        logger.error(
            "Failed to enqueue assessment after mark_complete for session %s: %s",
            session.id,
            exc,
        )

    job_result = await db.execute(select(Job).where(Job.id == candidate.job_id))
    job = job_result.scalars().first()

    response_data = InterviewSessionResponse.model_validate(session)
    response_data.interview_url = (
        f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    )
    response_data.candidate_name = candidate.name
    response_data.job_title = job.title if job else None
    logger.info(
        "HR marked interview complete: session=%s candidate=%s",
        session.id,
        candidate_id,
    )
    return response_data


# ---------------------------------------------------------------------------
# POST /api/interview/{token}/complete
# ---------------------------------------------------------------------------

@router.post("/interview/{token}/complete", status_code=status.HTTP_202_ACCEPTED)
async def complete_interview(token: str, db: AsyncSession = Depends(get_db)):
    """
    Mark the interview as completed and enqueue AI assessment generation.

    Returns 202 Accepted — the assessment is generated asynchronously.
    """
    from app.services.interview_guards import (
        assert_session_joinable,
        enforce_public_interview_rate_limit,
    )

    enforce_public_interview_rate_limit(token, "complete")

    result = await db.execute(
        select(InterviewSession).where(InterviewSession.unique_token == token)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    if session.status == "expired":
        raise HTTPException(status_code=410, detail="Interview link has expired.")

    # Already completed: skip join-window (candidate may finish after schedule window)
    if session.status == "completed":
        from app.models.models import InterviewReport
        from app.tasks.interview_tasks import enqueue_interview_assessment

        report_result = await db.execute(
            select(InterviewReport).where(
                InterviewReport.interview_session_id == session.id
            )
        )
        if not report_result.scalars().first():
            try:
                enqueue_interview_assessment(str(session.id))
            except Exception as exc:
                logger.error(
                    "Failed to re-enqueue assessment for completed session %s: %s",
                    session.id,
                    exc,
                )
            return {
                "message": "Interview already complete — assessment (re)scheduled.",
                "session_id": str(session.id),
            }
        return {"message": "Interview already marked complete", "session_id": str(session.id)}

    if session.status not in ("pending", "in_progress"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot complete interview in status '{session.status}'",
        )

    await assert_session_joinable(session, db)

    now = datetime.now(timezone.utc)
    session.status = "completed"
    session.completed_at = now
    if not session.started_at:
        session.started_at = now

    from app.services.mock_external import mock_livekit_enabled

    if mock_livekit_enabled() and not (session.transcript or "").strip():
        session.transcript = _STUB_INTERVIEW_TRANSCRIPT

    await db.commit()

    from app.tasks.interview_tasks import enqueue_interview_assessment

    if mock_livekit_enabled():
        from app.tasks.interview_tasks import generate_interview_report

        try:
            generate_interview_report.delay(str(session.id))
        except Exception as exc:
            logger.error(
                "Failed to enqueue mock assessment for session %s: %s",
                session.id,
                exc,
            )
            raise HTTPException(
                status_code=503,
                detail="Assessment queue is temporarily unavailable. Try again shortly.",
            ) from exc
        logger.info(
            "Mock interview completed: session=%s — mock transcript saved, assessment enqueued",
            session.id,
        )
        return {
            "message": "Interview marked complete (mock mode). Assessment is being generated.",
            "session_id": str(session.id),
        }

    # Schedule assessment with retries — waits for agent to save transcript, does not block on agent.
    try:
        enqueue_interview_assessment(str(session.id))
    except Exception as exc:
        logger.error(
            "Failed to enqueue assessment for session %s: %s",
            session.id,
            exc,
        )
        raise HTTPException(
            status_code=503,
            detail="Assessment queue is temporarily unavailable. Try again shortly.",
        ) from exc
    logger.info(
        "Interview completed: session=%s — assessment scheduled (agent-independent)",
        session.id,
    )

    return {
        "message": "Interview marked complete. Assessment is being generated.",
        "session_id": str(session.id),
    }


# ---------------------------------------------------------------------------
# POST /api/livekit/webhook
# ---------------------------------------------------------------------------

@router.post("/livekit/webhook", status_code=status.HTTP_200_OK)
async def livekit_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Handle LiveKit room webhook events.

    Handles 'room_finished' and 'egress_ended' events. Signature verified when secrets set.
    """
    from app.services.interview_guards import verify_livekit_webhook_body

    body: Dict[str, Any] = await verify_livekit_webhook_body(request)

    event = body.get("event", "")
    room_data = body.get("room", {}) or {}
    room_name: Optional[str] = room_data.get("name") or body.get("room_name")
    room_sid = room_data.get("sid") or body.get("room_sid") or room_name
    egress_info = body.get("egressInfo") or body.get("egress_info") or {}
    egress_id = egress_info.get("egressId") or egress_info.get("egress_id") or body.get("egress_id")

    from app.services.webhook_idempotency import claim_webhook_event

    idempotency_key = (
        f"{room_sid}:{event}"
        if room_sid
        else (f"egress:{egress_id}:{event}" if egress_id else None)
    )
    if idempotency_key and not claim_webhook_event("livekit", idempotency_key):
        return {"status": "duplicate"}

    logger.info("LiveKit webhook received: event=%s room=%s", event, room_name)

    if event == "room_finished" and room_name:
        from app.models.models import InterviewReport

        # Only complete in_progress sessions — never invent stub transcripts
        result = await db.execute(
            select(InterviewSession).where(
                InterviewSession.livekit_room_name == room_name,
                InterviewSession.status.in_(["in_progress", "completed"]),
            )
        )
        session = result.scalars().first()

        if session:
            if session.status == "in_progress":
                session.status = "completed"
                session.completed_at = datetime.now(timezone.utc)
                await db.commit()

            report_result = await db.execute(
                select(InterviewReport).where(
                    InterviewReport.interview_session_id == session.id
                )
            )
            if not report_result.scalars().first():
                from app.tasks.interview_tasks import enqueue_interview_assessment

                try:
                    enqueue_interview_assessment(str(session.id))
                except Exception as exc:
                    logger.error(
                        "livekit_webhook: failed to enqueue assessment for session %s: %s",
                        session.id,
                        exc,
                    )

            logger.info(
                "livekit_webhook: room_finished — session=%s assessment scheduled",
                session.id,
            )
        else:
            logger.info(
                "livekit_webhook: room_finished for room=%s — no in_progress session found (may already be completed)",
                room_name,
            )

    elif event == "egress_ended":
        if egress_id:
            result = await db.execute(
                select(InterviewSession).where(InterviewSession.egress_id == egress_id)
            )
            session = result.scalars().first()
            if session and session.recording_ready is not True:
                session.recording_ready = True
                await db.commit()
                logger.info(
                    "livekit_webhook: egress_ended — recording ready session=%s egress_id=%s",
                    session.id,
                    egress_id,
                )
            elif session:
                logger.info(
                    "livekit_webhook: egress_ended — already ready session=%s",
                    session.id,
                )
            else:
                logger.info(
                    "livekit_webhook: egress_ended — no session for egress_id=%s",
                    egress_id,
                )

    return {"received": True, "event": event}


# ---------------------------------------------------------------------------
# GET /api/candidates/{candidate_id}/report
# ---------------------------------------------------------------------------

@router.get("/candidates/{candidate_id}/report", response_model=InterviewReportResponse, dependencies=[_hr_auth])
async def get_interview_report(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Fetch the most recent interview report for a candidate.

    Returns 404 with 'Report not ready yet' when no report exists (assessment may still be running).
    Enriches response with candidate_name and job_title via joins.
    """
    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    # Prefer report for the latest session; fall back to latest-by-candidate only
    # when no session-scoped row exists (avoids attaching stale scores).
    session_result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.candidate_id == candidate_id)
        .order_by(InterviewSession.created_at.desc())
        .limit(1)
    )
    session = session_result.scalars().first()

    report = None
    if session:
        scoped = await db.execute(
            select(InterviewReport).where(
                InterviewReport.interview_session_id == session.id
            )
        )
        report = scoped.scalars().first()

    if not report:
        # Fallback: latest report for this candidate when current session has none.
        result = await db.execute(
            select(InterviewReport)
            .where(InterviewReport.candidate_id == candidate_id)
            .order_by(InterviewReport.created_at.desc())
        )
        report = result.scalars().first()

    if not report:
        raise HTTPException(status_code=404, detail="Report not ready yet")

    # Enrich with candidate name and job title via joins
    from app.models.models import Job as _Job
    job_result = await db.execute(
        select(_Job).where(_Job.id == report.job_id)
    )
    job = job_result.scalars().first()

    if not session or session.id != report.interview_session_id:
        session_result = await db.execute(
            select(InterviewSession).where(
                InterviewSession.id == report.interview_session_id
            )
        )
        session = session_result.scalars().first()

    report_dict = {
        col.key: getattr(report, col.key)
        for col in report.__table__.columns
    }
    report_dict["candidate_name"] = candidate.name if candidate else None
    report_dict["job_title"] = job.title if job else None

    raw = report.raw_report or {}
    if raw.get("assessment_mode") == "rubric":
        report_dict["question_scores"] = raw.get("question_scores")
        report_dict["rubric_total"] = raw.get("rubric_total")

    report_dict["transcript"] = session.transcript if session else None
    report_dict["transcript_segments"] = session.transcript_segments if session else None

    # Presigned playback URL for LiveKit egress recording (if uploaded to S3)
    recording_key = session.recording_key if session else None
    report_dict["recording_key"] = recording_key
    report_dict["recording_url"] = None
    recording_ready = session.recording_ready if session else None
    if recording_key and recording_ready is not False:
        from app.services.s3_service import generate_presigned_get_url

        report_dict["recording_url"] = generate_presigned_get_url(recording_key)

    return InterviewReportResponse.model_validate(report_dict)


@router.post(
    "/candidates/{candidate_id}/report/refresh",
    response_model=InterviewReportResponse,
    dependencies=[_hr_auth],
)
async def refresh_interview_report(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Regenerate rubric point coverage via OpenAI when the stored report is stale."""
    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    session_result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.candidate_id == candidate_id)
        .order_by(InterviewSession.created_at.desc())
        .limit(1)
    )
    session = session_result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="No interview session found")

    report_result = await db.execute(
        select(InterviewReport).where(
            InterviewReport.interview_session_id == session.id
        )
    )
    report = report_result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not ready yet")

    from app.models.models import Job as _Job
    from app.services.report_refresh_service import ensure_report_has_coverage

    job_result = await db.execute(select(_Job).where(_Job.id == report.job_id))
    job = job_result.scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    refreshed = await ensure_report_has_coverage(
        db,
        report,
        job,
        candidate,
        session.transcript or "",
    )
    if refreshed:
        await db.commit()
        await db.refresh(report)

    return await get_interview_report(candidate_id, actor, db)


# ---------------------------------------------------------------------------
# GET /api/jobs/{job_id}/interviews  (Task A-4)
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/interviews", response_model=list[InterviewSessionResponse], dependencies=[_hr_auth])
async def list_job_interviews(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    HR view: list all interview sessions for a job, enriched with candidate_name
    and interview_url. Ordered newest-first.
    """
    job = await get_tenant_job(db, job_id, actor.tenant_id)

    result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.job_id == job_id)
        .order_by(InterviewSession.created_at.desc())
    )
    sessions = result.scalars().all()

    if not sessions:
        return []

    # Batch-load all candidates in one query to avoid N+1
    candidate_ids = list({s.candidate_id for s in sessions})
    candidate_result = await db.execute(
        select(Candidate).where(Candidate.id.in_(candidate_ids))
    )
    candidate_map = {c.id: c for c in candidate_result.scalars().all()}

    enriched: list[InterviewSessionResponse] = []
    for session in sessions:
        r = InterviewSessionResponse.model_validate(session)
        r.interview_url = f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
        c = candidate_map.get(session.candidate_id)
        r.candidate_name = c.name if c else None
        r.job_title = job.title
        enriched.append(r)

    return enriched


# ---------------------------------------------------------------------------
# GET /api/jobs/{job_id}/interviews/pipeline
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}/interviews/pipeline",
    response_model=InterviewPipelineResponse,
    dependencies=[_hr_auth],
)
async def get_interview_pipeline(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    tab: Optional[
        Literal["pending", "scheduled", "ongoing", "completed", "flagged", "finalists"]
    ] = Query(
        default=None,
        description="Filter candidates to a single pipeline tab. Counts always reflect all tabs.",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    HR view: screening-passed candidates grouped into interview pipeline tabs.

    Tabs:
      - scheduled: no session yet, or link sent (session status pending)
      - pending: legacy alias for scheduled
      - ongoing: session in_progress
      - completed: session completed (pending/rejected HR decision)
      - finalists: completed and HR-approved
      - flagged: interview never produced a meaningful result
    """
    from app.services.interview_pipeline_service import get_interview_pipeline as build_pipeline

    await get_tenant_job(db, job_id, actor.tenant_id)
    try:
        return await build_pipeline(db, job_id, tab=tab)
    except ValueError as exc:
        if str(exc) == "Job not found":
            raise HTTPException(status_code=404, detail="Job not found") from exc
        raise


@router.get("/jobs/{job_id}/finalists", response_model=FinalistsResponse, dependencies=[_hr_auth])
async def get_finalists(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """List HR-approved finalists for a job (post-interview)."""
    from app.services.interview_finalist_service import list_finalists

    await get_tenant_job(db, job_id, actor.tenant_id)
    try:
        return await list_finalists(db, job_id)
    except ValueError as exc:
        if str(exc) == "Job not found":
            raise HTTPException(status_code=404, detail="Job not found") from exc
        raise


@router.patch(
    "/candidates/{candidate_id}/interview/decision",
    response_model=InterviewSessionResponse,
    dependencies=[_hr_auth],
)
async def update_interview_hr_decision(
    candidate_id: uuid.UUID,
    payload: InterviewHrDecisionUpdate,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Approve (move to Finalists) or reject (keep in Completed) after interview."""
    from app.services.interview_finalist_service import set_interview_hr_decision

    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)
    try:
        # Capture before from latest completed session if present
        before_decision = None
        sess_result = await db.execute(
            select(InterviewSession)
            .where(InterviewSession.candidate_id == candidate_id)
            .order_by(InterviewSession.created_at.desc())
            .limit(1)
        )
        latest = sess_result.scalars().first()
        if latest:
            before_decision = latest.hr_decision

        result = await set_interview_hr_decision(db, candidate_id, payload.hr_decision)
        await log_change(
            db,
            actor=actor,
            action="interview.decision_set",
            entity_type="interview",
            entity_id=result.id if hasattr(result, "id") else candidate_id,
            subject_label=await _candidate_label(db, candidate, candidate_id),
            feature="hr_decision",
            before={"hr_decision": before_decision},
            after={"hr_decision": payload.hr_decision},
            job_id=candidate.job_id if candidate else None,
            candidate_id=candidate_id,
        )
        await db.commit()
        return result
    except ValueError as exc:
        msg = str(exc)
        if msg == "Candidate not found":
            raise HTTPException(status_code=404, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc


# ---------------------------------------------------------------------------
# POST /api/candidates/{candidate_id}/interview/resend-email
# ---------------------------------------------------------------------------

@router.post(
    "/candidates/{candidate_id}/interview/resend-email",
    response_model=InterviewSessionResponse,
    dependencies=[_hr_auth],
)
async def resend_interview_email(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Resend the interview invitation email for a pending session."""
    from app.models.models import Job
    from app.services.interview_schedule_service import resend_interview_notification_email

    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    session_result = await db.execute(
        select(InterviewSession)
        .where(
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.job_id == candidate.job_id,
            InterviewSession.status == "pending",
        )
        .order_by(InterviewSession.created_at.desc())
        .limit(1)
    )
    session = session_result.scalars().first()
    if not session:
        raise HTTPException(
            status_code=404,
            detail="No pending interview session found for this candidate.",
        )

    job = await db.get(Job, candidate.job_id)
    job_title = job.title if job else "the position"
    timezone_name = (job.screening_timezone if job else None) or "Asia/Kolkata"

    email_sent = await resend_interview_notification_email(
        db,
        session,
        candidate,
        job_title,
        timezone_name=timezone_name,
    )
    if not email_sent:
        raise HTTPException(
            status_code=502,
            detail=(
                "Failed to send interview email. Check Gmail configuration "
                "and that the candidate has a valid email address."
            ),
        )

    await log_change(
        db,
        actor=actor,
        action="interview.email_resent",
        entity_type="interview",
        entity_id=session.id,
        subject_label=await _candidate_label(db, candidate, candidate_id),
        feature="interview_link",
        before=None,
        after={"email_sent_at": session.email_sent_at.isoformat() if session.email_sent_at else None},
        job_id=candidate.job_id,
        candidate_id=candidate_id,
    )
    await db.commit()
    await db.refresh(session)

    response_data = InterviewSessionResponse.model_validate(session)
    response_data.interview_url = f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
    response_data.candidate_name = candidate.name
    response_data.job_title = job_title
    return response_data


# ---------------------------------------------------------------------------
# POST /api/candidates/{candidate_id}/interview/reschedule
# ---------------------------------------------------------------------------

@router.post(
    "/candidates/{candidate_id}/interview/reschedule",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_hr_auth],
)
async def reschedule_interview_endpoint(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    body: Optional[InterviewScheduleRequest] = Body(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Expire the previous interview link, create a new session, and email the candidate.
    """
    from app.services.interview_reschedule_service import reschedule_interview

    try:
        candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)
        result = await reschedule_interview(db, candidate_id, schedule=body)
        await log_change(
            db,
            actor=actor,
            action="interview.rescheduled",
            entity_type="interview",
            entity_id=result.id if hasattr(result, "id") else candidate_id,
            subject_label=await _candidate_label(db, candidate, candidate_id),
            feature="interview_session",
            before=None,
            after={"session_id": str(result.id) if hasattr(result, "id") else None},
            job_id=candidate.job_id if candidate else None,
            candidate_id=candidate_id,
        )
        await db.commit()
        return result
    except ValueError as exc:
        msg = str(exc)
        if msg == "Candidate not found":
            raise HTTPException(status_code=404, detail=msg) from exc
        if "already exists" in msg:
            raise HTTPException(status_code=409, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc


# ---------------------------------------------------------------------------
# POST /api/candidates/{candidate_id}/interview/retry-assessment
# ---------------------------------------------------------------------------

@router.post(
    "/candidates/{candidate_id}/interview/retry-assessment",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[_hr_auth],
)
async def retry_interview_assessment(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Re-enqueue assessment generation for the latest failed interview session."""
    from app.tasks.interview_tasks import generate_interview_report

    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.candidate_id == candidate_id)
        .order_by(InterviewSession.created_at.desc())
    )
    session = result.scalars().first()
    if not session:
        raise HTTPException(status_code=404, detail="No interview session found")

    if session.status != "assessment_failed":
        raise HTTPException(
            status_code=400,
            detail="Assessment retry is only available for failed assessments",
        )

    before_status = session.status
    session.status = "completed"
    await log_change(
        db,
        actor=actor,
        action="interview.retry_assessment",
        entity_type="interview",
        entity_id=session.id,
        subject_label=await _candidate_label(db, candidate, candidate_id),
        feature="status",
        before={"status": before_status},
        after={"status": "completed"},
        job_id=session.job_id,
        candidate_id=candidate_id,
    )
    await db.commit()

    try:
        generate_interview_report.delay(str(session.id))
    except Exception as exc:
        logger.error(
            "Failed to enqueue assessment retry for session %s: %s",
            session.id,
            exc,
        )
        raise HTTPException(
            status_code=503,
            detail="Assessment queue is temporarily unavailable. Try again shortly.",
        ) from exc
    return {
        "message": "Assessment retry enqueued",
        "session_id": str(session.id),
    }
