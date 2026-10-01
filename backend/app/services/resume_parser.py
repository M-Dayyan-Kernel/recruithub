import json
import logging
from openai import AsyncOpenAI
from app.core.config import settings

logger = logging.getLogger(__name__)

PARSE_SYSTEM_PROMPT = """You are a resume parser. Extract structured information from the resume text provided.
Return ONLY valid JSON with exactly these fields:
- name: string (candidate's full name)
- email: string (email address)
- phone: string (phone number with country code if present)
- skills: array of strings (all technical skills, tools, languages, frameworks mentioned)
- total_experience_years: number (float, total professional experience in years)
- experience: array of objects with {company: string, title: string, duration: string, description: string}
- education: array of objects with {institution: string, degree: string, field: string, year: string}
- current_company: string (most recent employer name)
- current_role: string (most recent job title)
If any field cannot be found in the resume, use null for that field.
Skills must be a flat array of individual skill strings (e.g. ["Python", "React", "PostgreSQL"])."""


# Minimum resume text length before we attempt GPT parsing
MIN_RESUME_LENGTH = 50

_EMPTY_RESUME: dict = {
    "name": None, "email": None, "phone": None,
    "skills": [], "total_experience_years": 0,
    "experience": [], "education": [],
    "current_company": None, "current_role": None,
}


async def parse_resume(raw_text: str) -> dict:
    """Parse resume text into structured JSON using GPT-4o."""
    # Guard: don't call GPT for empty or trivially short input — avoids hallucination
    if not raw_text or len(raw_text.strip()) < MIN_RESUME_LENGTH:
        logger.warning(
            "parse_resume: input too short (%d chars) — returning empty record",
            len(raw_text) if raw_text else 0,
        )
        return dict(_EMPTY_RESUME)

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    # Truncate to ~8000 chars to stay within context limits
    truncated_text = raw_text[:8000] if len(raw_text) > 8000 else raw_text

    response = await client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": PARSE_SYSTEM_PROMPT},
            {"role": "user", "content": f"Parse this resume and return structured JSON:\n\n{truncated_text}"},
        ],
        temperature=0,
        max_tokens=2000,
    )

    content = response.choices[0].message.content
    parsed = json.loads(content)
    logger.info(f"Successfully parsed resume. Skills found: {len(parsed.get('skills') or [])}")
    return parsed
