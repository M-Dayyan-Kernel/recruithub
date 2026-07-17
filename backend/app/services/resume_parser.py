import asyncio
import json
import logging
from openai import OpenAI

from app.core.config_loader import config
from app.prompts.resume import PARSE_SYSTEM_PROMPT, build_parse_user_prompt

logger = logging.getLogger(__name__)

_EMPTY_RESUME: dict = {
    "name": None, "email": None, "phone": None,
    "skills": [], "total_experience_years": 0,
    "experience": [], "education": [],
    "current_company": None, "current_role": None,
}


def _parse_resume_sync(raw_text: str, api_key: str) -> dict:
    """Sync OpenAI call — safe under Celery asyncio.run() on Windows."""
    client = OpenAI(api_key=api_key)
    model_cfg = config.models.resume_parse
    max_chars = config.parsing.resume_max_chars
    truncated_text = raw_text[:max_chars] if len(raw_text) > max_chars else raw_text
    response = client.chat.completions.create(
        model=model_cfg.name,
        response_format=model_cfg.openai_response_format(),
        messages=[
            {"role": "system", "content": PARSE_SYSTEM_PROMPT},
            {"role": "user", "content": build_parse_user_prompt(truncated_text)},
        ],
        temperature=model_cfg.temperature,
        max_tokens=model_cfg.max_tokens,
    )
    content = response.choices[0].message.content
    parsed = json.loads(content)
    logger.info("Successfully parsed resume. Skills found: %d", len(parsed.get("skills") or []))
    return parsed


async def parse_resume(raw_text: str, api_key: str) -> dict:
    """Parse resume text into structured JSON using configured OpenAI model."""
    from app.services.mock_external import mock_openai_enabled, mock_resume_parse

    # Guard: don't call GPT for empty or trivially short input — avoids hallucination
    if not raw_text or len(raw_text.strip()) < config.parsing.min_resume_chars:
        logger.warning(
            "parse_resume: input too short (%d chars) — returning empty record",
            len(raw_text) if raw_text else 0,
        )
        return dict(_EMPTY_RESUME)

    if mock_openai_enabled():
        return mock_resume_parse(raw_text)

    return await asyncio.to_thread(_parse_resume_sync, raw_text, api_key)
