"""
Vapi.ai Outbound Call Service — Sprint 5

Initiates AI voice screening calls via Vapi.ai REST API.
Business orchestration (prompts, payload assembly) lives here; HTTP transport in VapiClient.
"""

import logging
import uuid
from typing import TYPE_CHECKING, Optional
from urllib.parse import urlencode

from app.clients import mocks, vapi_client
from app.core.config_loader import config
from app.prompts.screening import (
    SCREENING_END_CALL_MESSAGE,
    build_screening_call_prompt,
    build_screening_first_message,
)
from app.services.screening_defaults import (
    format_screening_questions_for_prompt,
    merge_screening_questions,
)

if TYPE_CHECKING:
    from app.models.models import Candidate, Job
    from app.services.tenant_integrations_service import TenantIntegrations

logger = logging.getLogger(__name__)


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


def _build_outbound_call_payload(
    *,
    candidate_name: str,
    candidate_phone: str,
    job_title: str,
    job_description: str,
    screening_questions: list | None,
    required_skills: list | None,
    screening_call_id: uuid.UUID,
) -> dict:
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
        "phoneNumberId": "",  # filled by caller
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

    return payload


async def get_vapi_call(
    vapi_call_id: str,
    *,
    timeout: float | None = None,
    api_key: str | None = None,
    integrations: Optional["TenantIntegrations"] = None,
) -> dict:
    """Fetch call details from Vapi REST API."""
    return await vapi_client().get_call(
        vapi_call_id,
        timeout=timeout,
        api_key=api_key,
        integrations=integrations,
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
    if mocks.mock_vapi_enabled():
        call_id = mocks.mock_vapi_call_id()
        logger.info(
            "Mock Vapi call initiated: vapi_call_id=%s screening_call_id=%s candidate=%s",
            call_id,
            screening_call_id,
            candidate.name,
        )
        return call_id

    client = vapi_client()
    api_key, phone_number_id = client.resolve_credentials(integrations)

    payload = _build_outbound_call_payload(
        candidate_name=candidate.name,
        candidate_phone=candidate.phone,
        job_title=job.title,
        job_description=job.description or "",
        screening_questions=job.screening_questions,
        required_skills=job.required_skills,
        screening_call_id=screening_call_id,
    )
    payload["phoneNumberId"] = phone_number_id

    vapi_call_id = await client.create_outbound_call(payload, api_key=api_key)
    logger.info(
        "Vapi call initiated: vapi_call_id=%s screening_call_id=%s candidate=%s",
        vapi_call_id,
        screening_call_id,
        candidate.name,
    )
    return vapi_call_id
