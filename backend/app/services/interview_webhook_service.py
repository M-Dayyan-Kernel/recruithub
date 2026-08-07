"""LiveKit interview webhook handling."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import InterviewReport, InterviewSession
from app.repositories.interview_repository import InterviewRepository
from app.services.interview_public_service import _ensure_recording_ready
from app.services.webhook_idempotency import claim_webhook_event_async

logger = logging.getLogger(__name__)


class InterviewWebhookService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        interview_repo: InterviewRepository | None = None,
    ) -> None:
        self._session = session
        self._interviews = interview_repo or InterviewRepository(session)

    async def handle_event(self, request: Request) -> dict[str, Any]:
        """
        Handle LiveKit room webhook events.

        Handles 'room_finished' and 'egress_ended' events. Signature verified when secrets set.
        """
        from app.services.interview_guards import verify_livekit_webhook_body

        body: dict[str, Any] = await verify_livekit_webhook_body(request)

        event = body.get("event", "")
        room_data = body.get("room", {}) or {}
        room_name: Optional[str] = room_data.get("name") or body.get("room_name")
        room_sid = room_data.get("sid") or body.get("room_sid") or room_name
        egress_info = body.get("egressInfo") or body.get("egress_info") or {}
        egress_id = (
            egress_info.get("egressId")
            or egress_info.get("egress_id")
            or body.get("egress_id")
        )

        idempotency_key = (
            f"{room_sid}:{event}"
            if room_sid
            else (f"egress:{egress_id}:{event}" if egress_id else None)
        )
        if idempotency_key and not await claim_webhook_event_async("livekit", idempotency_key):
            return {"status": "duplicate"}

        logger.info("LiveKit webhook received: event=%s room=%s", event, room_name)

        if event == "room_finished" and room_name:
            result = await self._session.execute(
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
                    await self._session.commit()

                    from app.modules.talentos_integration.interview_status_sync import (
                        sync_interview_status_to_talentos,
                    )

                    await sync_interview_status_to_talentos(self._session, session)

                if session.recording_key and session.recording_ready is not True:
                    await _ensure_recording_ready(session, self._session)

                report_result = await self._session.execute(
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
                result = await self._session.execute(
                    select(InterviewSession).where(InterviewSession.egress_id == egress_id)
                )
                session = result.scalars().first()
                if session and session.recording_ready is not True:
                    session.recording_ready = True
                    await self._session.commit()
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
