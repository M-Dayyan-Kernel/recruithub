"""
Vapi.ai Outbound Call Service — Sprint 5

Initiates AI voice screening calls via Vapi.ai REST API.

Uses sync httpx.Client (via asyncio.to_thread) so Celery's asyncio.run() on Windows
does not hit "Event loop is closed" during AsyncClient transport teardown.
"""

import asyncio
import logging
import uuid
from typing import TYPE_CHECKING, Optional

import httpx

from app.core.config_loader import config
from app.prompts.screening import (
    SCREENING_END_CALL_MESSAGE,
    build_screening_call_prompt,
    build_screening_first_message,
)

if TYPE_CHECKING:
    from app.models.models import Candidate, Job
    from app.services.tenant_integrations_service import TenantIntegrations

logger = logging.getLogger(__name__)


from app.services.screening_defaults import format_screening_questions_for_prompt, merge_screening_questions


def _build_screening_prompt(
    candidate_name: str,
    job_title: str,
    job_description: str,
    screening_questions: list | None = None,
    required_skills: list | None = None,
) -> str:
    """Build the system prompt for the AI screening call."""
    questions = merge_screening_questions(screening_questions, None, job_title)
    questions_block = format_screening_questions_for_prompt(questions, job_title)

    return build_screening_call_prompt(
        candidate_name=candidate_name,
        job_title=job_title,
        job_description=job_description,
        questions_block=questions_block,
        required_skills=required_skills,
    )


def _vapi_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


def _resolve_vapi_credentials(
    integrations: Optional["TenantIntegrations"] = None,
    *,
    api_key: str | None = None,
) -> tuple[str, str]:
    """Return (api_key, phone_number_id), preferring tenant integrations then platform .env."""
    key = (api_key or "").strip()
    phone_id = ""
    if integrations is not None:
        integrations.require("vapi_api_key", "vapi_phone_number_id")
        key = key or integrations.vapi_api_key
        phone_id = integrations.vapi_phone_number_id
    if not key:
        key = config.VAPI_API_KEY or ""
    if not phone_id:
        phone_id = config.VAPI_PHONE_NUMBER_ID or ""
    if not key:
        raise ValueError("VAPI API key is not configured")
    if not phone_id:
        raise ValueError("VAPI phone number ID is not configured")
    return key, phone_id


def _get_vapi_call_sync(vapi_call_id: str, timeout: float, api_key: str) -> dict:
    with httpx.Client(timeout=timeout) as client:
        response = client.get(
            f"{config.vapi.api_base}/call/{vapi_call_id}",
            headers=_vapi_headers(api_key),
        )
        if response.status_code != 200:
            raise Exception(
                f"Vapi API error {response.status_code}: {response.text[:500]}"
            )
        return response.json()


async def get_vapi_call(
    vapi_call_id: str,
    *,
    timeout: float | None = None,
    api_key: str | None = None,
    integrations: Optional["TenantIntegrations"] = None,
) -> dict:
    """Fetch call details from Vapi REST API."""
    from app.services.mock_external import mock_vapi_enabled, mock_vapi_get_call

    if mock_vapi_enabled():
        return mock_vapi_get_call(vapi_call_id)

    key, _ = _resolve_vapi_credentials(integrations, api_key=api_key)
    resolved_timeout = (
        config.vapi.status_timeout_seconds if timeout is None else timeout
    )
    return await asyncio.to_thread(
        _get_vapi_call_sync, vapi_call_id, resolved_timeout, key
    )


def is_vapi_call_ended(vapi_call: dict) -> bool:
    """True only when Vapi reports the dial has actually finished."""
    status = (vapi_call.get("status") or "").lower().replace("_", "-")
    active_statuses = ("ringing", "in-progress", "forwarding", "queued", "scheduled")

    if status in active_statuses:
        return False

    if status in (
        "ended",
        "completed",
        "failed",
        "busy",
        "no-answer",
        "canceled",
        "cancelled",
    ):
        return True

    ended_at = vapi_call.get("endedAt") or vapi_call.get("ended_at")
    if ended_at and status not in active_statuses:
        return True

    ended_reason = vapi_call.get("endedReason") or vapi_call.get("ended_reason")
    return bool(ended_reason) and status not in active_statuses


def map_vapi_status_to_call_status(vapi_status: str | None) -> str | None:
    """Map Vapi call.status to our ScreeningCall.call_status."""
    if not vapi_status:
        return None
    status = vapi_status.lower().replace("_", "-")
    if status in ("queued", "scheduled"):
        return "initiated"
    if status in ("ringing", "in-progress", "forwarding"):
        return "in_progress"
    if status == "ended":
        return "completed"
    if status in ("failed", "busy", "no-answer", "canceled", "cancelled"):
        return "failed"
    return None


def _initiate_screening_call_sync(
    *,
    candidate_name: str,
    candidate_phone: str,
    job_title: str,
    job_description: str,
    screening_questions: list | None,
    required_skills: list | None,
    screening_call_id: uuid.UUID,
    api_key: str,
    phone_number_id: str,
) -> str:
    screening_prompt = _build_screening_prompt(
        candidate_name=candidate_name,
        job_title=job_title,
        job_description=job_description or "",
        screening_questions=screening_questions,
        required_skills=required_skills,
    )

    vapi = config.vapi
    payload = {
        "type": "outboundPhoneCall",
        "phoneNumberId": phone_number_id,
        "customer": {
            "number": candidate_phone,
        },
        "assistant": {
            "model": {
                "provider": vapi.llm.provider,
                "model": vapi.llm.name,
                "messages": [
                    {
                        "role": "system",
                        "content": screening_prompt,
                    }
                ],
            },
            "voice": {
                "provider": vapi.voice.provider,
                "voiceId": vapi.voice.voice_id,
            },
            "firstMessage": build_screening_first_message(
                candidate_name,
                job_title,
            ),
            "firstMessageMode": vapi.first_message_mode,
            "endCallMessage": SCREENING_END_CALL_MESSAGE,
            "transcriber": {
                "provider": vapi.transcriber.provider,
                "model": vapi.transcriber.model,
                "language": vapi.transcriber.language,
            },
            "backgroundSound": vapi.background_sound,
            "silenceTimeoutSeconds": vapi.silence_timeout_seconds,
        },
        "metadata": {
            "screening_call_id": str(screening_call_id),
        },
    }

    if config.BACKEND_PUBLIC_URL:
        from urllib.parse import urlencode

        webhook_url = (
            f"{config.BACKEND_PUBLIC_URL.rstrip('/')}/api/screening/webhook"
        )
        secret = (config.VAPI_WEBHOOK_SECRET or "").strip()
        if secret:
            webhook_url = f"{webhook_url}?{urlencode({'token': secret})}"
        payload["assistant"]["serverUrl"] = webhook_url
        payload["assistant"]["serverMessages"] = list(vapi.webhook_messages)
    else:
        logger.warning(
            "BACKEND_PUBLIC_URL is not set — Vapi webhooks disabled; "
            "screening status relies on polling (slower updates)."
        )

    with httpx.Client(timeout=vapi.request_timeout_seconds) as client:
        response = client.post(
            f"{vapi.api_base}/call",
            json=payload,
            headers=_vapi_headers(api_key),
        )
        if response.status_code not in (200, 201):
            raise Exception(
                f"Vapi API error {response.status_code}: {response.text[:500]}"
            )
        data = response.json()

    vapi_call_id = data.get("id")
    if not vapi_call_id:
        raise Exception(f"Vapi response missing call ID. Response: {data}")

    logger.info(
        "Vapi call initiated: vapi_call_id=%s screening_call_id=%s candidate=%s",
        vapi_call_id,
        screening_call_id,
        candidate_name,
    )
    return vapi_call_id


async def initiate_screening_call(
    candidate: "Candidate",
    job: "Job",
    screening_call_id: uuid.UUID,
    *,
    integrations: Optional["TenantIntegrations"] = None,
) -> str:
    """
    Initiate an outbound AI voice screening call via Vapi.ai.

    Returns:
        vapi_call_id (str) — the call ID from Vapi response
    """
    from app.services.mock_external import mock_vapi_call_id, mock_vapi_enabled

    if mock_vapi_enabled():
        call_id = mock_vapi_call_id()
        logger.info(
            "Mock Vapi call initiated: vapi_call_id=%s screening_call_id=%s candidate=%s",
            call_id,
            screening_call_id,
            candidate.name,
        )
        return call_id

    api_key, phone_number_id = _resolve_vapi_credentials(integrations)

    return await asyncio.to_thread(
        _initiate_screening_call_sync,
        candidate_name=candidate.name,
        candidate_phone=candidate.phone,
        job_title=job.title,
        job_description=job.description or "",
        screening_questions=job.screening_questions,
        required_skills=job.required_skills,
        screening_call_id=screening_call_id,
        api_key=api_key,
        phone_number_id=phone_number_id,
    )
