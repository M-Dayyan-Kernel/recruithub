import json
import logging

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
- interview_evaluation_criteria: string or null (concise criteria for technical interview evaluation, inferred from role requirements if not explicit)
If experience is given as a single number (e.g. "5+ years"), set experience_min to that number and experience_max to null.
required_skills must be a flat array of individual skill strings (e.g. ["Python", "React", "PostgreSQL"]).
Use null for fields that cannot be determined from the document."""

MIN_JD_LENGTH = 50

_EMPTY_JD: dict = {
    "title": "",
    "description": "",
    "required_skills": [],
    "experience_min": None,
    "experience_max": None,
    "screening_criteria": None,
    "interview_evaluation_criteria": None,
}


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
    logger.info(
        "Parsed job description: title=%r, skills=%d",
        parsed.get("title"),
        len(parsed.get("required_skills") or []),
    )
    return parsed
