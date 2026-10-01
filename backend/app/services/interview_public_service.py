"""Candidate-facing interview session flows (token-based)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import InterviewCapacityError
from app.models.models import Candidate, InterviewSession, Job
from app.repositories.interview_repository import InterviewRepository
from app.schemas.schemas import InterviewSessionResponse, InterviewStartResponse

logger = logging.getLogger(__name__)

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


async def _ensure_recording_ready(session: InterviewSession, db: AsyncSession) -> bool:
    """Mark recording_ready when the egress MP4 exists in S3.

    LiveKit webhooks require a public BACKEND_PUBLIC_URL; local Docker uses
    localhost, so egress_ended may never arrive even after upload succeeds.
    """
    if session.recording_ready is True:
        return True
    key = (session.recording_key or "").strip()
    if not key:
        return False
    from app.services.s3_service import object_exists_async

    if not await object_exists_async(key):
        return False
    session.recording_ready = True
    await db.commit()
    logger.info("Recording ready via S3 check: session=%s key=%s", session.id, key)
    _enqueue_video_proctoring_safe(session.id)
    return True


def _enqueue_video_proctoring_safe(session_id: uuid.UUID) -> None:
    """Best-effort enqueue of video analyze; never raise into callers."""
    try:
        from app.tasks.interview_tasks import enqueue_video_proctoring

        enqueue_video_proctoring(str(session_id))
    except Exception as exc:
        logger.error(
            "Failed to enqueue video proctoring for session %s: %s",
            session_id,
            exc,
        )


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

    raise InterviewCapacityError(retry_after_minutes=busy_retry_minutes())


class InterviewPublicService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        interview_repo: InterviewRepository | None = None,
    ) -> None:
        self._session = session
        self._interviews = interview_repo or InterviewRepository(session)

    async def get_session(self, token: str) -> InterviewSessionResponse:
        """Candidate app: fetch session details using the unique link token."""
        session = await self._interviews.get_session_by_token(token)
        if not session:
            raise HTTPException(status_code=404, detail="Interview session not found")

        candidate_result = await self._session.execute(
            select(Candidate).where(Candidate.id == session.candidate_id)
        )
        candidate = candidate_result.scalars().first()

        job_result = await self._session.execute(
            select(Job).where(Job.id == session.job_id)
        )
        job = job_result.scalars().first()

        if session.expires_at and session.expires_at < datetime.now(timezone.utc):
            if session.status not in ("completed", "expired"):
                session.status = "expired"
                await self._session.commit()
                await self._interviews.refresh(session)

        response_data = InterviewSessionResponse.model_validate(session)
        response_data.candidate_name = candidate.name if candidate else None
        response_data.job_title = job.title if job else None

        from app.clients.mocks import mock_livekit_enabled

        response_data.mock_mode = mock_livekit_enabled()

        await _apply_interview_capacity_fields(response_data, self._session)

        return response_data

    async def start(self, token: str) -> InterviewStartResponse:
        """
        Create a LiveKit room (first start) or return a fresh token (rejoin).

        - pending → creates room, dispatches AI agent, returns candidate token
        - in_progress → reissues candidate token for the existing room (rejoin)
        """
        from app.services.interview_guards import (
            assert_session_joinable,
            enforce_public_interview_rate_limit,
        )
        from app.services.livekit_service import create_room, generate_candidate_token
        from app.services.tenant_integrations_service import load_tenant_integrations

        await enforce_public_interview_rate_limit(token, "start")

        session = await self._interviews.get_session_by_token(token)
        if not session:
            raise HTTPException(status_code=404, detail="Interview session not found")

        if session.status == "completed":
            raise HTTPException(status_code=409, detail="Interview already completed.")
        if session.status == "expired":
            raise HTTPException(status_code=410, detail="Interview link has expired.")

        await assert_session_joinable(session, self._session)

        candidate_result = await self._session.execute(
            select(Candidate).where(Candidate.id == session.candidate_id)
        )
        candidate = candidate_result.scalars().first()
        candidate_name = candidate.name if candidate else "Candidate"

        job_result = await self._session.execute(select(Job).where(Job.id == session.job_id))
        job = job_result.scalars().first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found for this interview")

        try:
            integrations = await load_tenant_integrations(self._session, job.tenant_id)
            integrations.require("livekit_url", "livekit_api_key", "livekit_api_secret")
        except ValueError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        livekit_url = integrations.livekit_url
        if not (livekit_url or "").strip():
            raise HTTPException(
                status_code=503,
                detail="LiveKit URL is not configured for this tenant. Cannot start interview.",
            )

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

        if not await has_live_interview_slot(self._session):
            _raise_interview_capacity_full()

        room_name = f"interview-{session.id}"
        now = datetime.now(timezone.utc)
        egress_id: Optional[str] = None
        recording_key: Optional[str] = None

        try:
            _, egress_id, recording_key = await create_room(room_name, integrations)
            candidate_token = generate_candidate_token(room_name, candidate_name, integrations)
        except Exception as exc:
            logger.error("Failed to create LiveKit room/token %s: %s", room_name, exc)
            await self._session.execute(
                update(InterviewSession)
                .where(
                    InterviewSession.id == session.id,
                    InterviewSession.status == "pending",
                )
                .values(livekit_room_name=None, egress_id=None, recording_key=None)
            )
            await self._session.commit()
            raise HTTPException(
                status_code=502, detail=f"Failed to create interview room: {exc}"
            ) from exc

        atomic = await self._session.execute(
            update(InterviewSession)
            .where(InterviewSession.unique_token == token, InterviewSession.status == "pending")
            .values(
                status="in_progress",
                started_at=now,
                livekit_room_name=room_name,
                egress_id=egress_id,
                recording_key=recording_key,
                recording_ready=None,
            )
            .returning(InterviewSession.id)
        )
        updated = atomic.scalars().first()
        if not updated:
            await self._interviews.refresh(session)
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
        await self._session.commit()

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

    async def complete(self, token: str) -> dict:
        """
        Mark the interview as completed and enqueue AI assessment generation.

        Returns 202 Accepted payload — the assessment is generated asynchronously.
        """
        from app.services.interview_guards import (
            assert_session_joinable,
            enforce_public_interview_rate_limit,
        )

        await enforce_public_interview_rate_limit(token, "complete")

        session = await self._interviews.get_session_by_token(token)
        if not session:
            raise HTTPException(status_code=404, detail="Interview session not found")

        if session.status == "expired":
            raise HTTPException(status_code=410, detail="Interview link has expired.")

        if session.status == "completed":
            from app.models.models import InterviewReport
            from app.tasks.interview_tasks import enqueue_interview_assessment

            report_result = await self._session.execute(
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

        await assert_session_joinable(session, self._session)

        now = datetime.now(timezone.utc)
        session.status = "completed"
        session.completed_at = now
        if not session.started_at:
            session.started_at = now

        from app.clients.mocks import mock_livekit_enabled

        if mock_livekit_enabled() and not (session.transcript or "").strip():
            session.transcript = _STUB_INTERVIEW_TRANSCRIPT

        await self._session.commit()

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
