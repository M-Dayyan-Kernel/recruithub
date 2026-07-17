import asyncio
import json
import logging
from openai import OpenAI

from app.prompts.resume import PARSE_SYSTEM_PROMPT, build_parse_user_prompt

logger = logging.getLogger(__name__)

# Minimum resume text length before we attempt GPT parsing
MIN_RESUME_LENGTH = 50

_EMPTY_RESUME: dict = {
    "name": None, "email": None, "phone": None,
    "skills": [], "total_experience_years": 0,
    "experience": [], "education": [],
    "current_company": None, "current_role": None,
}


def _parse_resume_sync(raw_text: str, api_key: str) -> dict:
    """Sync OpenAI call — safe under Celery asyncio.run() on Windows."""
    client = OpenAI(api_key=api_key)
    truncated_text = raw_text[:8000] if len(raw_text) > 8000 else raw_text
    response = client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": PARSE_SYSTEM_PROMPT},
            {"role": "user", "content": build_parse_user_prompt(truncated_text)},
        ],
        temperature=0,
        max_tokens=2000,
    )
    content = response.choices[0].message.content
    parsed = json.loads(content)
    logger.info("Successfully parsed resume. Skills found: %d", len(parsed.get("skills") or []))
    return parsed


async def parse_resume(raw_text: str, api_key: str) -> dict:
    """Parse resume text into structured JSON using GPT-4o."""
    from app.services.mock_external import mock_openai_enabled, mock_resume_parse

    # Guard: don't call GPT for empty or trivially short input — avoids hallucination
    if not raw_text or len(raw_text.strip()) < MIN_RESUME_LENGTH:
        logger.warning(
            "parse_resume: input too short (%d chars) — returning empty record",
            len(raw_text) if raw_text else 0,
        )
        return dict(_EMPTY_RESUME)

    if mock_openai_enabled():
        return mock_resume_parse(raw_text)

    return await asyncio.to_thread(_parse_resume_sync, raw_text, api_key)
