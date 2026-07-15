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

from app.core.config import settings

if TYPE_CHECKING:
    from app.models.models import Candidate, Job
    from app.services.tenant_integrations_service import TenantIntegrations

logger = logging.getLogger(__name__)

VAPI_API_BASE = "https://api.vapi.ai"


from app.services.screening_defaults import format_screening_questions_for_prompt, merge_screening_questions


def _build_screening_prompt(
    candidate_name: str,
    job_title: str,
    job_description: str,
    screening_questions: list | None = None,
    required_skills: list | None = None,
) -> str:
    """Build the system prompt for the AI screening call."""
    skills_line = ""
    if required_skills:
        skills_line = f"\nKey skills for this role: {', '.join(required_skills)}\n"

    questions = merge_screening_questions(screening_questions, None, job_title)
    questions_block = format_screening_questions_for_prompt(questions, job_title)

    return f"""You are a professional HR screening assistant calling on behalf of a hiring company.
You are conducting a brief phone screening for the role of: {job_title}.
Candidate name: {candidate_name}

Job context: {job_description[:500] if job_description else "Not provided"}
{skills_line}
Your goal is to have a natural, friendly conversation to assess the candidate's fit.
Ask the following screening questions one at a time, in a conversational tone (skip any already answered):

{questions_block}

Guidelines:
- Be friendly, professional, and concise.
- Listen carefully to answers and acknowledge them naturally.
- If the candidate seems confused, rephrase the question simply.
- Do not make promises about the outcome of the screening.
- Keep the total call under 10 minutes.
- End gracefully after covering all screening questions, or if the candidate is not interested.
"""


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
        key = settings.VAPI_API_KEY or ""
    if not phone_id:
        phone_id = settings.VAPI_PHONE_NUMBER_ID or ""
    if not key:
        raise ValueError("VAPI API key is not configured")
    if not phone_id:
        raise ValueError("VAPI phone number ID is not configured")
    return key, phone_id


def _get_vapi_call_sync(vapi_call_id: str, timeout: float, api_key: str) -> dict:
    with httpx.Client(timeout=timeout) as client:
        response = client.get(
            f"{VAPI_API_BASE}/call/{vapi_call_id}",
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
    timeout: float = 5.0,
    api_key: str | None = None,
    integrations: Optional["TenantIntegrations"] = None,
) -> dict:
    """Fetch call details from Vapi REST API."""
    from app.services.mock_external import mock_vapi_enabled, mock_vapi_get_call

    if mock_vapi_enabled():
        return mock_vapi_get_call(vapi_call_id)

    key, _ = _resolve_vapi_credentials(integrations, api_key=api_key)
    return await asyncio.to_thread(_get_vapi_call_sync, vapi_call_id, timeout, key)


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

    payload = {
        "type": "outboundPhoneCall",
        "phoneNumberId": phone_number_id,
        "customer": {
            "number": candidate_phone,
        },
        "assistant": {
            "model": {
                "provider": "openai",
                "model": "gpt-4o",
                "messages": [
                    {
                        "role": "system",
                        "content": screening_prompt,
                    }
                ],
            },
            "voice": {
                "provider": "deepgram",
                "voiceId": "asteria",
            },
            "firstMessage": (
                f"Hello {candidate_name}, this is an AI assistant calling on behalf of the hiring team "
                f"regarding the {job_title} position. Do you have a few minutes to speak?"
            ),
            "firstMessageMode": "assistant-speaks-first",
            "endCallMessage": "Thank you for your time. We'll review your responses and be in touch soon. Goodbye!",
            "transcriber": {
                "provider": "deepgram",
                "model": "nova-2",
                "language": "en",
            },
            "backgroundSound": "office",
            "silenceTimeoutSeconds": 20,
        },
        "metadata": {
            "screening_call_id": str(screening_call_id),
        },
    }

    if settings.BACKEND_PUBLIC_URL:
        webhook_url = (
            f"{settings.BACKEND_PUBLIC_URL.rstrip('/')}/api/screening/webhook"
        )
        payload["assistant"]["serverUrl"] = webhook_url
        payload["assistant"]["serverMessages"] = [
            "status-update",
            "end-of-call-report",
        ]
    else:
        logger.warning(
            "BACKEND_PUBLIC_URL is not set — Vapi webhooks disabled; "
            "screening status relies on polling (slower updates)."
        )

    with httpx.Client(timeout=30.0) as client:
        response = client.post(
            f"{VAPI_API_BASE}/call",
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
