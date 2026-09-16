"""Submit and poll external video proctoring analyze jobs for interview recordings."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.video_proctoring_client import VideoProctoringClient, VideoProctoringError
from app.core.config_loader import config
from app.models.models import InterviewSession

logger = logging.getLogger(__name__)

TerminalAction = Literal["done", "retry", "skip"]


def video_proctoring_configured() -> bool:
    return bool((config.VIDEO_PROCTORING_URL or "").strip())


def session_video_proctoring_payload(session: InterviewSession | None) -> dict[str, Any] | None:
    """Shape for InterviewReportResponse.video_proctoring; None if never started."""
    if session is None or not session.video_proctoring_status:
        return None
    return {
        "status": session.video_proctoring_status,
        "error": session.video_proctoring_error,
        "result": session.video_proctoring_result,
    }


class VideoProctoringService:
    def __init__(
        self,
        db: AsyncSession,
        *,
        client: VideoProctoringClient | None = None,
    ) -> None:
        self._db = db
        self._client = client or VideoProctoringClient()

    async def process_tick(
        self, interview_session_id: str, poll_attempt: int = 0
    ) -> TerminalAction:
        """Submit analyze if needed, or poll job status. Returns done | retry | skip."""
        if not self._client.configured:
            logger.info(
                "video_proctoring: VIDEO_PROCTORING_URL unset — skip session=%s",
                interview_session_id,
            )
            return "skip"

        session_uuid = uuid.UUID(interview_session_id)
        result = await self._db.execute(
            select(InterviewSession).where(InterviewSession.id == session_uuid)
        )
        session = result.scalars().first()
        if not session:
            logger.warning(
                "video_proctoring: session %s not found", interview_session_id
            )
            return "skip"

        if session.video_proctoring_status in ("succeeded", "failed"):
            return "done"

        video_key = (session.recording_key or "").strip()
        if not video_key:
            session.video_proctoring_status = "failed"
            session.video_proctoring_error = "No recording key on interview session."
            session.video_proctoring_result = None
            await self._db.commit()
            return "done"

        try:
            if not session.video_proctoring_job_id:
                return await self._submit(session, video_key, interview_session_id)
            return await self._poll(session, poll_attempt)
        except VideoProctoringError as exc:
            if exc.status_code == 400:
                session.video_proctoring_status = "failed"
                session.video_proctoring_error = str(exc)[:500]
                session.video_proctoring_result = None
                await self._db.commit()
                logger.error(
                    "video_proctoring: non-retryable error session=%s: %s",
                    interview_session_id,
                    exc,
                )
                return "done"
            logger.warning(
                "video_proctoring: transient error session=%s attempt=%s: %s",
                interview_session_id,
                poll_attempt,
                exc,
            )
            max_polls = int(config.VIDEO_PROCTORING_MAX_POLLS)
            if poll_attempt >= max_polls:
                session.video_proctoring_status = "failed"
                session.video_proctoring_error = str(exc)[:500]
                session.video_proctoring_result = None
                await self._db.commit()
                return "done"
            return "retry"

    async def _submit(
        self,
        session: InterviewSession,
        video_key: str,
        interview_session_id: str,
    ) -> TerminalAction:
        data = await self._client.submit_analyze(
            video_key, idempotency_key=interview_session_id
        )
        job_id = str(data["job_id"])
        session.video_proctoring_job_id = job_id
        session.video_proctoring_status = data.get("status") or "queued"
        session.video_proctoring_error = None
        session.video_proctoring_result = None
        await self._db.commit()
        logger.info(
            "video_proctoring: submitted analyze session=%s job_id=%s",
            interview_session_id,
            job_id,
        )
        return "retry"

    async def _poll(
        self, session: InterviewSession, poll_attempt: int
    ) -> TerminalAction:
        job_id = session.video_proctoring_job_id
        assert job_id
        data = await self._client.get_job(job_id)
        status = (data.get("status") or "").lower()
        session.video_proctoring_status = status or session.video_proctoring_status

        if status == "succeeded":
            session.video_proctoring_result = data.get("result")
            session.video_proctoring_error = None
            await self._db.commit()
            logger.info(
                "video_proctoring: succeeded session=%s job_id=%s",
                session.id,
                job_id,
            )
            return "done"

        if status == "failed":
            err = data.get("error") or "Proctoring job failed."
            session.video_proctoring_result = None
            session.video_proctoring_error = str(err)[:500]
            await self._db.commit()
            logger.warning(
                "video_proctoring: failed session=%s job_id=%s error=%s",
                session.id,
                job_id,
                err,
            )
            return "done"

        max_polls = int(config.VIDEO_PROCTORING_MAX_POLLS)
        if poll_attempt >= max_polls:
            session.video_proctoring_status = "failed"
            session.video_proctoring_error = "Proctoring job timed out waiting for result."
            session.video_proctoring_result = None
            await self._db.commit()
            logger.warning(
                "video_proctoring: max polls session=%s job_id=%s",
                session.id,
                job_id,
            )
            return "done"

        await self._db.commit()
        return "retry"
