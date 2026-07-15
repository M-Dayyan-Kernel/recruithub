import json
import logging
import uuid

from openai import AsyncOpenAI

from app.services.interview_question_constraints import (
    DIFFICULTY_TIER_GUIDANCE,
    TECHNICAL_ONLY_PROMPT_RULES,
)
from app.services.screening_defaults import merge_screening_questions

logger = logging.getLogger(__name__)

PARSE_JD_SYSTEM_PROMPT = f"""You are a job description parser. Extract structured information from the job description text provided.
Return ONLY valid JSON with exactly these fields:
- title: string (job title)
- description: string (full role description — responsibilities, requirements, and context combined into readable prose)
- required_skills: array of strings (individual technical skills, tools, languages, frameworks mentioned)
- experience_min: number or null (minimum years of experience required, if stated)
- experience_max: number or null (maximum years of experience required, if stated)
- screening_questions: array of objects, each with {{ "id": "<uuid string>", "question": "<screening question text>" }}
  Generate 2-5 ADDITIONAL role-specific phone screening questions beyond standard HR topics (availability, CTC, notice period).
  Do NOT repeat standard HR screening topics — focus on must-haves from the JD (skills, certifications, domain experience, work authorization, etc.).
  Each question must have a unique id (UUID string).
- interview_questions: array of objects, each with {{ "id": "<uuid string>", "question": "<interview question text>", "score": <positive integer> }}
  Generate 4-6 role-relevant TECHNICAL interview questions only (stack, architecture, debugging, system design, tools, trade-offs).
  Calibrate question depth to experience_min/experience_max and job title (junior fundamentals, mid applied design, senior system design).
  Point weights (score field) must sum to approximately 100 across all questions.
  Each question must have a unique id (UUID string).
  Do NOT generate behavioural, culture-fit, motivation-only, or soft-skill questions (no conflict stories, leadership style, strengths/weaknesses).
  Do NOT include "tell me about yourself" in the rubric.

{TECHNICAL_ONLY_PROMPT_RULES}

{DIFFICULTY_TIER_GUIDANCE}

  VOICE-ONLY: This is a spoken interview with no code editor or compiler. Every question must be answerable by talking (explain, describe experience, walk through approach). Do NOT generate live coding, "write a function", coding exercises, whiteboard implementation, or screen-share tasks.
If experience is given as a single number (e.g. "5+ years"), set experience_min to that number and experience_max to null.
required_skills must be a flat array of individual skill strings (e.g. ["Python", "React", "PostgreSQL"]).
Use null for fields that cannot be determined from the document. Use empty array for interview_questions if none can be inferred."""

MIN_JD_LENGTH = 50

_EMPTY_JD: dict = {
    "title": "",
    "description": "",
    "required_skills": [],
    "experience_min": None,
    "experience_max": None,
    "screening_questions": [],
    "interview_questions": [],
}


def _normalize_parsed_screening_questions(raw_questions: list | None) -> list[dict]:
    if not raw_questions:
        return []
    normalized = []
    for item in raw_questions:
        if not isinstance(item, dict):
            continue
        question = (item.get("question") or "").strip()
        if not question:
            continue
        normalized.append({
            "id": item.get("id") or str(uuid.uuid4()),
            "question": question,
        })
    return normalized


def _filter_oral_interview_questions(raw_questions: list[dict]) -> list[dict]:
    """Drop questions that require live coding; voice interviews cannot assess them."""
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
    """Drop behavioural/soft-skill questions; rubric must be technical only."""
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
            score = 10
        normalized.append({
            "id": item.get("id") or str(uuid.uuid4()),
            "question": question,
            "score": score,
        })
    return _filter_technical_interview_questions(_filter_oral_interview_questions(normalized))


async def parse_job_description(raw_text: str, api_key: str) -> dict:
    """Parse job description text into structured JSON using GPT-4o."""
    if not raw_text or len(raw_text.strip()) < MIN_JD_LENGTH:
        logger.warning(
            "parse_job_description: input too short (%d chars)",
            len(raw_text) if raw_text else 0,
        )
        return dict(_EMPTY_JD)

    from app.services.mock_external import mock_jd_parse, mock_openai_enabled

    if mock_openai_enabled():
        parsed = mock_jd_parse(raw_text)
        parsed["screening_questions"] = _normalize_parsed_screening_questions(
            parsed.get("screening_questions")
        )
        parsed["interview_questions"] = _normalize_parsed_questions(
            parsed.get("interview_questions")
        )
        return parsed

    client = AsyncOpenAI(api_key=api_key)
    truncated_text = raw_text[:12000] if len(raw_text) > 12000 else raw_text

    response = await client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": PARSE_JD_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Parse this job description and return structured JSON:\n\n{truncated_text}",
            },
        ],
        temperature=0,
        max_tokens=3000,
    )

    content = response.choices[0].message.content
    parsed = json.loads(content)
    parsed["interview_questions"] = _normalize_parsed_questions(parsed.get("interview_questions"))
    job_title = (parsed.get("title") or "").strip()
    additional_screening = _normalize_parsed_screening_questions(parsed.get("screening_questions"))
    parsed["screening_questions"] = merge_screening_questions(None, additional_screening, job_title)
    logger.info(
        "Parsed job description: title=%r, skills=%d, screening_questions=%d, interview_questions=%d",
        parsed.get("title"),
        len(parsed.get("required_skills") or []),
        len(parsed.get("screening_questions") or []),
        len(parsed.get("interview_questions") or []),
    )
    return parsed
