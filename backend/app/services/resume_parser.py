import asyncio
import json
import logging
from datetime import datetime, timezone

from openai import OpenAI
from pydantic import ValidationError

from app.core.config_loader import config
from app.prompts.resume import PARSE_SYSTEM_PROMPT, PROMPT_VERSION, build_parse_user_prompt
from app.schemas.ai_outputs import ParsedResumeData
from app.services.text_utils import head_tail_truncate

logger = logging.getLogger(__name__)

_EMPTY_RESUME: dict = {
    "name": None, "email": None, "phone": None,
    "skills": [], "total_experience_years": 0,
    "experience": [], "education": [],
    "current_company": None, "current_role": None,
}


def _attach_parse_meta(parsed: dict, model_name: str) -> dict:
    """Attach model/prompt provenance without treating _meta as LLM output."""
    result = dict(parsed)
    result["_meta"] = {
        "model": model_name,
        "prompt_version": PROMPT_VERSION,
        "parsed_at": datetime.now(timezone.utc).isoformat(),
    }
    return result


def _validate_parsed_resume(raw: dict) -> dict:
    """Validate LLM JSON against ParsedResumeData; raise ValidationError on failure."""
    validated = ParsedResumeData.model_validate(raw)
    return validated.model_dump()


def _parse_resume_sync(raw_text: str, api_key: str) -> dict:
    """Sync OpenAI call — safe under Celery asyncio.run() on Windows."""
    client = OpenAI(api_key=api_key)
    model_cfg = config.models.resume_parse
    truncated_text = head_tail_truncate(raw_text, config.parsing.resume_max_chars)
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
    raw = json.loads(content or "{}")
    try:
        parsed = _validate_parsed_resume(raw)
    except ValidationError as exc:
        logger.error("resume parse output failed schema validation: %s", exc)
        raise
    logger.info("Successfully parsed resume. Skills found: %d", len(parsed.get("skills") or []))
    return _attach_parse_meta(parsed, model_cfg.name)


async def parse_resume(raw_text: str, api_key: str) -> dict:
    """Parse resume text into structured JSON using configured OpenAI model."""
    from app.services.mock_external import mock_openai_enabled, mock_resume_parse

    # Guard: don't call GPT for empty or trivially short input — avoids hallucination
    if not raw_text or len(raw_text.strip()) < config.parsing.min_resume_chars:
        logger.warning(
            "parse_resume: input too short (%d chars) — returning empty record",
            len(raw_text) if raw_text else 0,
        )
        return _attach_parse_meta(dict(_EMPTY_RESUME), "none")

    if mock_openai_enabled():
        mocked = mock_resume_parse(raw_text)
        validated = _validate_parsed_resume(mocked)
        return _attach_parse_meta(validated, config.models.resume_parse.name)

    return await asyncio.to_thread(_parse_resume_sync, raw_text, api_key)
