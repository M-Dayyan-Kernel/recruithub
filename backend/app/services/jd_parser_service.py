"""Parse job description text into structured fields via OpenAI."""

from __future__ import annotations

import json
import logging
import uuid

from app.clients import mocks, openai_client
from app.core.config_loader import config
from app.prompts.job_description import (
    PARSE_JD_SYSTEM_PROMPT,
    build_parse_jd_user_prompt,
)
from app.services.screening_defaults import (
    clean_work_location,
    normalize_role_questions,
    parse_work_mode,
    MAX_WORK_LOCATION_CHARS,
)

logger = logging.getLogger(__name__)

_EMPTY_JD: dict = {
    "title": "",
    "description": "",
    "required_skills": [],
    "seniority_level": None,
    "work_mode": None,
    "work_location": None,
    "screening_questions": [],
    "interview_questions": [],
}


def _normalize_parsed_work_arrangement(parsed: dict) -> None:
    """Keep only a work mode the JD actually states, and a location that fits where it is used.

    The model is told to answer null rather than guess; anything outside the three modes is
    treated as not stated, and HR then chooses. A remote job has no location.
    """
    mode = parse_work_mode(parsed.get("work_mode"))
    location = clean_work_location(parsed.get("work_location"))
    if mode == "remote" or (location is not None and len(location) > MAX_WORK_LOCATION_CHARS):
        location = None
    parsed["work_mode"] = mode
    parsed["work_location"] = location


def _filter_oral_interview_questions(raw_questions: list[dict]) -> list[dict]:
    from app.services.interview_question_constraints import question_requires_live_coding

    kept = []
    for item in raw_questions:
        question = (item.get("question") or "").strip()
        if question_requires_live_coding(question):
            logger.warning("JD parse dropped non-oral interview question: %r", question[:80])
            continue
        kept.append(item)
    return kept


def _filter_technical_interview_questions(raw_questions: list[dict]) -> list[dict]:
    from app.services.interview_question_constraints import question_is_behavioural

    kept = []
    for item in raw_questions:
        question = (item.get("question") or "").strip()
        if question_is_behavioural(question):
            logger.warning("JD parse dropped behavioural interview question: %r", question[:80])
            continue
        kept.append(item)
    return kept


def _normalize_parsed_questions(raw_questions: list | None) -> list[dict]:
    if not raw_questions:
        return []
    normalized = []
    for item in raw_questions:
        if not isinstance(item, dict):
            continue
        question = (item.get("question") or "").strip()
        if not question:
            continue
        try:
            score = int(item.get("score") or 0)
        except (TypeError, ValueError):
            score = 0
        if score < 1:
            score = config.parsing.default_question_score
        normalized.append({
            "id": item.get("id") or str(uuid.uuid4()),
            "question": question,
            "score": score,
        })
    return _filter_technical_interview_questions(_filter_oral_interview_questions(normalized))


class JdParserService:
    async def parse(self, raw_text: str, api_key: str) -> dict:
        if not raw_text or len(raw_text.strip()) < config.parsing.min_jd_chars:
            logger.warning(
                "parse_job_description: input too short (%d chars)",
                len(raw_text) if raw_text else 0,
            )
            return dict(_EMPTY_JD)

        if mocks.mock_openai_enabled():
            parsed = mocks.mock_jd_parse(raw_text)
            parsed["screening_questions"] = normalize_role_questions(
                parsed.get("screening_questions")
            )
            _normalize_parsed_work_arrangement(parsed)
            parsed["interview_questions"] = _normalize_parsed_questions(
                parsed.get("interview_questions")
            )
            return parsed

        max_chars = config.parsing.jd_max_chars
        truncated_text = raw_text[:max_chars] if len(raw_text) > max_chars else raw_text

        content = await openai_client().chat_completion_json(
            "jd_parse",
            [
                {"role": "system", "content": PARSE_JD_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": build_parse_jd_user_prompt(truncated_text),
                },
            ],
            api_key=api_key,
        )
        parsed = json.loads(content)
        parsed["interview_questions"] = _normalize_parsed_questions(
            parsed.get("interview_questions")
        )
        # Only the role-specific questions: the standard ones are the server's, built from the
        # job's title and work arrangement once HR has confirmed them.
        parsed["screening_questions"] = normalize_role_questions(parsed.get("screening_questions"))
        _normalize_parsed_work_arrangement(parsed)
        logger.info(
            "Parsed job description: title=%r, skills=%d, screening_questions=%d, interview_questions=%d",
            parsed.get("title"),
            len(parsed.get("required_skills") or []),
            len(parsed.get("screening_questions") or []),
            len(parsed.get("interview_questions") or []),
        )
        return parsed
