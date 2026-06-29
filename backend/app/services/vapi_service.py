"""
Vapi.ai Outbound Call Service — Sprint 5

Initiates AI voice screening calls via Vapi.ai REST API.
Uses httpx (async) for the HTTP call.
"""

import logging
import uuid
from typing import TYPE_CHECKING

import httpx

from app.core.config import settings

if TYPE_CHECKING:
    from app.models.models import Candidate, Job

logger = logging.getLogger(__name__)

VAPI_API_BASE = "https://api.vapi.ai"


def _build_screening_prompt(candidate_name: str, job_title: str, job_description: str) -> str:
    """Build the system prompt for the AI screening call."""
    return f"""You are a professional HR screening assistant calling on behalf of a hiring company.
You are conducting a brief phone screening for the role of: {job_title}.

Job context: {job_description[:500] if job_description else "Not provided"}

Your goal is to have a natural, friendly conversation to assess the candidate's fit.
Ask the following questions one at a time, in a conversational tone:

1. **Availability**: When are you available to start a new role? Are you currently looking actively?
2. **Employment status**: Are you currently employed? What is your current role and company?
3. **Relevant experience**: Can you briefly describe your most relevant experience for this {job_title} role?
4. **Current CTC**: What is your current compensation package (annual CTC)?
5. **Expected CTC**: What are your salary expectations for this role?
6. **Notice period**: What is your notice period at your current company?
7. **Location preference**: Are you open to working from [location]? Do you prefer remote, hybrid, or on-site?
8. **Willingness to proceed**: Based on what you've heard, are you interested in moving forward with this opportunity?

Guidelines:
- Be friendly, professional, and concise.
- Listen carefully to answers and acknowledge them naturally.
- If the candidate seems confused, rephrase the question simply.
- Do not make promises about the outcome of the screening.
- Keep the total call under 10 minutes.
- End gracefully after covering all questions or if the candidate is not interested.
"""


async def initiate_screening_call(
    candidate: "Candidate",
    job: "Job",
    screening_call_id: uuid.UUID,
) -> str:
    """
    Initiate an outbound AI voice screening call via Vapi.ai.

    Args:
        candidate: Candidate ORM model (must have .phone, .name)
        job: Job ORM model (must have .title, .description)
        screening_call_id: UUID of the ScreeningCall record for metadata tracking

    Returns:
        vapi_call_id (str) — the call ID from Vapi response

    Raises:
        Exception: with status code and body if Vapi API returns a non-2xx response
    """
    screening_prompt = _build_screening_prompt(
        candidate_name=candidate.name,
        job_title=job.title,
        job_description=job.description or "",
    )

    payload = {
        "type": "outboundPhoneCall",
        "phoneNumberId": settings.VAPI_PHONE_NUMBER_ID,
        "customer": {
            "number": candidate.phone,
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
                f"Hello {candidate.name}, this is an AI assistant calling on behalf of the hiring team "
                f"regarding the {job.title} position. Do you have a few minutes to speak?"
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

    headers = {
        "Authorization": f"Bearer {settings.VAPI_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{VAPI_API_BASE}/call",
            json=payload,
            headers=headers,
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
        candidate.name,
    )
    return vapi_call_id
