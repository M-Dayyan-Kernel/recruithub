"""
Interviews Router — Sprint 6

Endpoints for LiveKit interview session management:
  POST /api/candidates/{candidate_id}/interview/send   — create session + send email
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

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.core.config import settings
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
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# POST /api/candidates/{candidate_id}/interview/send
# ---------------------------------------------------------------------------

@router.post(
    "/candidates/{candidate_id}/interview/send",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def send_interview_link(
    candidate_id: uuid.UUID,
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
    from app.services.email_service import send_interview_link as email_send

    # Load candidate
    candidate_result = await db.execute(
        select(Candidate).where(Candidate.id == candidate_id)
    )
    candidate = candidate_result.scalars().first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

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

    # Check for existing active session (pending or in_progress)
    existing_result = await db.execute(
        select(InterviewSession).where(
            InterviewSession.candidate_id == candidate_id,
            InterviewSession.job_id == candidate.job_id,
            InterviewSession.status.in_(["pending", "in_progress"]),
        )
    )
    existing_session = existing_result.scalars().first()
    if existing_session:
        raise HTTPException(
            status_code=409,
            detail=f"An active interview session already exists (status={existing_session.status}). "
                   f"Token: {existing_session.unique_token}",
        )

    # Create InterviewSession
    unique_token = str(uuid.uuid4())
    interview_session = InterviewSession(
        candidate_id=candidate_id,
        job_id=candidate.job_id,
        unique_token=unique_token,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(interview_session)
    await db.flush()  # get the session.id before commit

    # Build interview URL (candidate frontend)
    interview_url = f"{settings.CANDIDATE_APP_URL}/interview/{unique_token}"

    # Load job title for email
    from app.models.models import Job
    job_result = await db.execute(select(Job).where(Job.id == candidate.job_id))
    job = job_result.scalars().first()
    job_title = job.title if job else "the position"

    # Send email (non-fatal)
    email_sent = email_send(
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        job_title=job_title,
        interview_url=interview_url,
    )

    if email_sent:
        interview_session.email_sent_at = datetime.now(timezone.utc)
        logger.info(
            "Interview invitation sent to %s (session=%s)", candidate.email, interview_session.id
        )
    else:
        logger.warning(
            "Email delivery failed for candidate=%s session=%s — session still created, link available",
            candidate_id,
            interview_session.id,
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
    from app.services.livekit_service import create_room, generate_candidate_token

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

    candidate_result = await db.execute(
        select(Candidate).where(Candidate.id == session.candidate_id)
    )
    candidate = candidate_result.scalars().first()
    candidate_name = candidate.name if candidate else "Candidate"

    # Rejoin — session already started, return a new access token
    if session.status == "in_progress" and session.livekit_room_name:
        try:
            candidate_token = generate_candidate_token(
                session.livekit_room_name, candidate_name
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
            livekit_url=settings.LIVEKIT_URL,
        )

    if session.status != "pending":
        raise HTTPException(
            status_code=409,
            detail="Interview already started or not in pending state.",
        )

    # First start — atomic transition pending → in_progress
    room_name = f"interview-{session.id}"
    now = datetime.now(timezone.utc)

    atomic = await db.execute(
        update(InterviewSession)
        .where(InterviewSession.unique_token == token, InterviewSession.status == "pending")
        .values(status="in_progress", started_at=now, livekit_room_name=room_name)
        .returning(InterviewSession.id)
    )
    updated = atomic.scalars().first()
    if not updated:
        raise HTTPException(
            status_code=409,
            detail="Interview already started or not in pending state.",
        )
    await db.commit()

    # Create LiveKit room + dispatch agent + start recording
    egress_id: Optional[str] = None
    try:
        _, egress_id = await create_room(room_name)
    except Exception as exc:
        logger.error("Failed to create LiveKit room %s: %s", room_name, exc)
        raise HTTPException(status_code=502, detail=f"Failed to create interview room: {exc}")

    if egress_id:
        await db.execute(
            update(InterviewSession)
            .where(InterviewSession.id == session.id)
            .values(egress_id=egress_id)
        )
        await db.commit()

    try:
        candidate_token = generate_candidate_token(room_name, candidate_name)
    except Exception as exc:
        logger.error("Failed to generate LiveKit token: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed to generate access token: {exc}")

    logger.info(
        "Interview started: session=%s room=%s candidate=%s",
        session.id,
        room_name,
        candidate_name,
    )

    return InterviewStartResponse(
        room_name=room_name,
        token=candidate_token,
        livekit_url=settings.LIVEKIT_URL,
    )


# ---------------------------------------------------------------------------
# POST /api/interview/{token}/complete
# ---------------------------------------------------------------------------

@router.post("/interview/{token}/complete", status_code=status.HTTP_202_ACCEPTED)
async def complete_interview(token: str, db: AsyncSession = Depends(get_db)):
    """
    Mark the interview as completed and enqueue AI assessment generation.

    Returns 202 Accepted — the assessment is generated asynchronously.
    """
    result = await db.execute(
        select(InterviewSession).where(InterviewSession.unique_token == token)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    if session.status == "completed":
        # Idempotent — already completed, don't re-queue
        return {"message": "Interview already marked complete", "session_id": str(session.id)}

    if session.status not in ("pending", "in_progress"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot complete interview in status '{session.status}'",
        )

    session.status = "completed"
    session.completed_at = datetime.now(timezone.utc)

    await db.commit()

    # NOTE: assessment is triggered by the interview agent AFTER it saves the transcript
    # (avoids race condition where assessment ran before transcript was written to DB)
    logger.info(
        "Interview completed: session=%s — waiting for agent to save transcript + trigger assessment", session.id
    )

    return {
        "message": "Interview marked complete. Assessment will be generated after transcript is saved.",
        "session_id": str(session.id),
    }


# ---------------------------------------------------------------------------
# POST /api/livekit/webhook
# ---------------------------------------------------------------------------

@router.post("/livekit/webhook", status_code=status.HTTP_200_OK)
async def livekit_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Handle LiveKit room webhook events.

    Handles 'room_finished' event: if the session is still in_progress,
    mark it complete and trigger assessment.
    """
    from app.tasks.interview_tasks import generate_interview_report

    try:
        body: Dict[str, Any] = await request.json()
    except Exception:
        logger.warning("livekit_webhook: failed to parse JSON body")
        return {"received": False, "error": "Invalid JSON"}

    event = body.get("event", "")
    room_data = body.get("room", {})
    room_name: Optional[str] = room_data.get("name") or body.get("room_name")

    logger.info("LiveKit webhook received: event=%s room=%s", event, room_name)

    if event == "room_finished" and room_name:
        # Find session by livekit_room_name
        result = await db.execute(
            select(InterviewSession).where(
                InterviewSession.livekit_room_name == room_name,
                InterviewSession.status == "in_progress",
            )
        )
        session = result.scalars().first()

        if session:
            session.status = "completed"
            session.completed_at = datetime.now(timezone.utc)
            await db.commit()

            generate_interview_report.delay(str(session.id))

            logger.info(
                "livekit_webhook: room_finished — session=%s completed and assessment enqueued",
                session.id,
            )
        else:
            logger.info(
                "livekit_webhook: room_finished for room=%s — no in_progress session found (may already be completed)",
                room_name,
            )

    return {"received": True, "event": event}


# ---------------------------------------------------------------------------
# GET /api/candidates/{candidate_id}/report
# ---------------------------------------------------------------------------

@router.get("/candidates/{candidate_id}/report", response_model=InterviewReportResponse)
async def get_interview_report(candidate_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Fetch the most recent interview report for a candidate.

    Returns 404 with 'Report not ready yet' when no report exists (assessment may still be running).
    Enriches response with candidate_name and job_title via joins.
    """
    result = await db.execute(
        select(InterviewReport)
        .where(InterviewReport.candidate_id == candidate_id)
        .order_by(InterviewReport.created_at.desc())
    )
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not ready yet")

    # Enrich with candidate name and job title via joins
    candidate_result = await db.execute(
        select(Candidate).where(Candidate.id == candidate_id)
    )
    candidate = candidate_result.scalars().first()

    from app.models.models import Job as _Job
    job_result = await db.execute(
        select(_Job).where(_Job.id == report.job_id)
    )
    job = job_result.scalars().first()

    # Build response by merging ORM attributes with enriched fields
    # (direct attr assignment on Pydantic v2 model works but may not survive
    # FastAPI's response_model re-validation — use model_validate on a dict instead)
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

    return InterviewReportResponse.model_validate(report_dict)


# ---------------------------------------------------------------------------
# GET /api/jobs/{job_id}/interviews  (Task A-4)
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/interviews", response_model=list[InterviewSessionResponse])
async def list_job_interviews(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    HR view: list all interview sessions for a job, enriched with candidate_name
    and interview_url. Ordered newest-first.
    """
    from app.models.models import Job as _Job

    job = await db.get(_Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

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
        r.interview_url = f"{settings.CANDIDATE_APP_URL}/interview/{session.unique_token}"
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
)
async def get_interview_pipeline(
    job_id: uuid.UUID,
    tab: Optional[Literal["pending", "scheduled", "ongoing", "completed"]] = Query(
        default=None,
        description="Filter candidates to a single pipeline tab. Counts always reflect all tabs.",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    HR view: screening-passed candidates grouped into interview pipeline tabs.

    Tabs:
      - pending: no interview session yet
      - scheduled: link sent, session status pending
      - ongoing: session in_progress
      - completed: session completed (has_report indicates report availability)
    """
    from app.services.interview_pipeline_service import get_interview_pipeline as build_pipeline

    try:
        return await build_pipeline(db, job_id, tab=tab)
    except ValueError as exc:
        if str(exc) == "Job not found":
            raise HTTPException(status_code=404, detail="Job not found") from exc
        raise
