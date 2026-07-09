"""
Generate and merge hidden expected answer points for interview rubric questions.
"""

import json
import logging
from typing import Any, Optional

from openai import AsyncOpenAI

from app.core.config import settings

logger = logging.getLogger(__name__)

EXPECTED_POINTS_SYSTEM_PROMPT = """You are an expert interviewer creating an answer key for a rubric question.
Given a job context and one interview question, return ONLY valid JSON:

{
  "expected_points": [
    "<concise assessable criterion 1>",
    "<concise assessable criterion 2>"
  ]
}

Rules:
- Return 3 to 6 bullet points
- Each point must be a single objective criterion that can be marked covered or not
- No paragraphs, no numbering prefixes in the strings
- Points should reflect what a strong candidate would mention for this question in this role
- Do not include meta commentary"""


def _job_context(job: Any) -> str:
    skills = ", ".join(job.required_skills or []) or "Not specified"
    exp = f"{job.experience_min}–{job.experience_max} years"
    return f"""Title: {job.title}
Required Skills: {skills}
Experience: {exp}
Description:
{(job.description or "")[:2500]}"""


async def generate_expected_points(question_text: str, job: Any) -> list[str]:
    """Generate 3–6 expected answer bullet points for one interview question."""
    if not (question_text or "").strip():
        return []

    if not settings.OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY not set; skipping expected_points generation")
        return []

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    user_content = f"""== JOB CONTEXT ==
{_job_context(job)}

== INTERVIEW QUESTION ==
{question_text.strip()}
"""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": EXPECTED_POINTS_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=600,
        )
        data = json.loads(response.choices[0].message.content or "{}")
        raw = data.get("expected_points") or []
        if not isinstance(raw, list):
            return []
        points = [str(p).strip() for p in raw if str(p).strip()]
        return points[:6] if points else []
    except Exception:
        logger.exception("Failed to generate expected_points for question")
        return []


def _existing_by_id(existing: Optional[list[dict]]) -> dict[str, dict]:
    if not existing:
        return {}
    return {
        str(q.get("id")): q
        for q in existing
        if isinstance(q, dict) and q.get("id")
    }


async def enrich_interview_questions(
    incoming: list[dict],
    existing: Optional[list[dict]],
    job: Any,
) -> list[dict]:
    """
    Merge incoming rubric questions with stored expected_points.
    Regenerates expected_points for new or changed questions.
    """
    prior = _existing_by_id(existing)
    enriched: list[dict] = []

    for item in incoming:
        if not isinstance(item, dict):
            continue
        qid = str(item.get("id") or "")
        question = (item.get("question") or "").strip()
        score = int(item.get("score") or 0)
        if not question or score < 1:
            continue

        old = prior.get(qid)
        question_changed = not old or (old.get("question") or "").strip() != question
        is_new = qid not in prior

        if is_new or question_changed:
            expected_points = await generate_expected_points(question, job)
        else:
            raw_points = old.get("expected_points") if old else None
            if isinstance(raw_points, list):
                expected_points = [str(p).strip() for p in raw_points if str(p).strip()]
            else:
                expected_points = await generate_expected_points(question, job)

        enriched.append({
            "id": qid,
            "question": question,
            "score": score,
            "expected_points": expected_points or None,
        })

    return enriched
