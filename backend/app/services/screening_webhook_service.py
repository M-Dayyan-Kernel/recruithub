"""Vapi.ai screening webhook handling."""

from __future__ import annotations

import logging
import secrets as secrets_mod
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.exceptions import InvalidWebhookTokenError
from app.repositories.screening_repository import ScreeningRepository
from app.services.webhook_idempotency import claim_webhook_event_async

logger = logging.getLogger(__name__)


def _safe_enqueue(description: str, enqueue_fn) -> None:
    try:
        enqueue_fn()
    except Exception as exc:
        logger.error("Vapi webhook: failed to %s: %s", description, exc)


class ScreeningWebhookService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        screening_repo: ScreeningRepository | None = None,
    ) -> None:
        self._session = session
        self._screening = screening_repo or ScreeningRepository(session)

    def verify_token(self, request: Request) -> None:
        expected = (config.VAPI_WEBHOOK_SECRET or "").strip()
        if not expected:
            logger.warning(
                "VAPI_WEBHOOK_SECRET is empty — accepting unauthenticated screening webhooks"
            )
            return
        provided = (request.query_params.get("token") or "").strip()
        if not provided or not secrets_mod.compare_digest(provided, expected):
            raise InvalidWebhookTokenError()

    async def handle_event(self, body: dict[str, Any]) -> dict[str, str]:
        from app.tasks.screening_tasks import (
            apply_screening_call_end,
            can_set_call_status,
            process_screening_webhook as _process_task,
            set_call_status_if_allowed,
            sync_screening_call_status as _sync_task,
        )

        message = body.get("message") or {}
        message_type = message.get("type") or body.get("type")

        call_data = body.get("call") or message.get("call") or {}
        vapi_call_id = call_data.get("id")

        if not vapi_call_id:
            return {"status": "received"}

        if not await claim_webhook_event_async("vapi", f"{vapi_call_id}:{message_type}"):
            return {"status": "duplicate"}

        screening_call = await self._screening.get_by_vapi_call_id(vapi_call_id)

        if not screening_call:
            logger.warning(
                "Vapi webhook: no ScreeningCall found for vapi_call_id=%s", vapi_call_id
            )
            return {"status": "received"}

        if message_type == "status-update":
            return await self._handle_status_update(
                body, message, call_data, screening_call, _process_task
            )

        if message_type in ("end-of-call-report", "call-ended"):
            await self._apply_end_of_call(body, message, call_data, screening_call, _process_task)
            return {"status": "received"}

        if call_data.get("status", "").lower() == "ended" or body.get("artifact"):
            await self._apply_end_of_call(body, message, call_data, screening_call, _process_task)
            return {"status": "received"}

        _safe_enqueue(
            "sync screening call status",
            lambda: _sync_task.delay(str(screening_call.id)),
        )
        return {"status": "received"}

    async def _handle_status_update(
        self, body, message, call_data, screening_call, _process_task
    ) -> dict[str, str]:
        from app.tasks.screening_tasks import (
            TRANSCRIPT_ENRICH_DELAY_SEC,
            apply_screening_call_end,
            can_set_call_status,
            enrich_screening_transcript as _enrich_task,
            set_call_status_if_allowed,
            should_wait_for_transcript,
        )

        status_value = (message.get("status") or call_data.get("status") or "").lower()
        ended_reason = message.get("endedReason") or call_data.get("endedReason")
        artifact = message.get("artifact") or call_data.get("artifact") or {}
        transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""
        ended_at = call_data.get("endedAt") or message.get("endedAt")
        started_at = call_data.get("startedAt") or message.get("startedAt")

        if status_value in ("ringing", "in-progress", "forwarding", "queued", "scheduled"):
            if set_call_status_if_allowed(screening_call, "in_progress"):
                await self._session.commit()
            return {"status": "received"}

        if status_value in ("ended", "completed", "failed", "busy", "no-answer") or ended_at:
            if not can_set_call_status(screening_call.call_status, "completed"):
                return {"status": "received"}

            needs_transcript_wait = should_wait_for_transcript(
                transcript=transcript,
                started_at=started_at,
                ended_reason=ended_reason,
                call_status=screening_call.call_status,
            )
            await apply_screening_call_end(
                self._session,
                screening_call,
                ended_reason=ended_reason,
                transcript=transcript,
                schedule_retry=not needs_transcript_wait and not transcript.strip(),
                send_failure_email=not needs_transcript_wait,
                awaiting_transcript=needs_transcript_wait,
            )
            self._enqueue_transcript_processing(
                body,
                screening_call,
                transcript,
                needs_transcript_wait,
                _process_task,
                _enrich_task,
                TRANSCRIPT_ENRICH_DELAY_SEC,
            )
            return {"status": "received"}

        return {"status": "received"}

    async def _apply_end_of_call(
        self, body, message, call_data, screening_call, _process_task
    ) -> None:
        from app.tasks.screening_tasks import (
            TRANSCRIPT_ENRICH_DELAY_SEC,
            apply_screening_call_end,
            enrich_screening_transcript as _enrich_task,
            should_wait_for_transcript,
        )

        ended_reason = message.get("endedReason") or call_data.get("endedReason")
        artifact = (
            body.get("artifact")
            or message.get("artifact")
            or call_data.get("artifact")
            or {}
        )
        transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""
        started_at = call_data.get("startedAt") or message.get("startedAt")
        needs_transcript_wait = should_wait_for_transcript(
            transcript=transcript,
            started_at=started_at,
            ended_reason=ended_reason,
            call_status=screening_call.call_status,
        )
        await apply_screening_call_end(
            self._session,
            screening_call,
            ended_reason=ended_reason,
            transcript=transcript,
            schedule_retry=not needs_transcript_wait and not transcript.strip(),
            send_failure_email=not needs_transcript_wait,
            awaiting_transcript=needs_transcript_wait,
        )
        self._enqueue_transcript_processing(
            body,
            screening_call,
            transcript,
            needs_transcript_wait,
            _process_task,
            _enrich_task,
            TRANSCRIPT_ENRICH_DELAY_SEC,
        )

    @staticmethod
    def _enqueue_transcript_processing(
        body,
        screening_call,
        transcript,
        needs_transcript_wait,
        _process_task,
        _enrich_task,
        delay_sec,
    ) -> None:
        if (
            transcript.strip()
            and len(transcript.strip()) >= config.screening.min_substantive_transcript_chars
            and not needs_transcript_wait
        ):
            _safe_enqueue("process screening webhook", lambda: _process_task.delay(body))
        elif needs_transcript_wait or transcript.strip():
            _safe_enqueue(
                "enrich screening transcript",
                lambda: _enrich_task.apply_async(
                    args=[str(screening_call.id), 0],
                    countdown=delay_sec,
                ),
            )
