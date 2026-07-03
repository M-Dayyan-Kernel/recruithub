import json
import logging
import uuid

from openai import AsyncOpenAI

from app.core.config import settings

logger = logging.getLogger(__name__)

PARSE_JD_SYSTEM_PROMPT = """You are a job description parser. Extract structured information from the job description text provided.
Return ONLY valid JSON with exactly these fields:
- title: string (job title)
- description: string (full role description — responsibilities, requirements, and context combined into readable prose)
- required_skills: array of strings (individual technical skills, tools, languages, frameworks mentioned)
- experience_min: number or null (minimum years of experience required, if stated)
- experience_max: number or null (maximum years of experience required, if stated)
- screening_criteria: string or null (concise bullet-style criteria for phone screening, inferred from must-haves if not explicit)
- interview_questions: array of objects, each with { "id": "<uuid string>", "question": "<interview question text>", "score": <positive integer> }
  Generate 4-6 role-relevant technical/behavioural interview questions.
  Point weights (score field) must sum to approximately 100 across all questions.
  Each question must have a unique id (UUID string).
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
    "screening_criteria": None,
    "interview_questions": [],
}


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
    return normalized


async def parse_job_description(raw_text: str) -> dict:
    """Parse job description text into structured JSON using GPT-4o."""
    if not raw_text or len(raw_text.strip()) < MIN_JD_LENGTH:
        logger.warning(
            "parse_job_description: input too short (%d chars)",
            len(raw_text) if raw_text else 0,
        )
        return dict(_EMPTY_JD)

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
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
    logger.info(
        "Parsed job description: title=%r, skills=%d, interview_questions=%d",
        parsed.get("title"),
        len(parsed.get("required_skills") or []),
        len(parsed.get("interview_questions") or []),
    )
    return parsed
