"""
Generate and merge hidden expected answer points for interview rubric questions.
"""

import json
import logging
from typing import Any, Optional

from openai import AsyncOpenAI

from app.core.config_loader import config
from app.prompts.expected_answer import (
    EXPECTED_POINTS_SYSTEM_PROMPT,
    build_expected_points_user_prompt,
)
from app.services.interview_question_constraints import derive_difficulty_hint

logger = logging.getLogger(__name__)

def _job_context(job: Any) -> str:
    skills = ", ".join(job.required_skills or []) or "Not specified"
    exp = f"{job.experience_min}–{job.experience_max} years"
    return f"""Title: {job.title}
Required Skills: {skills}
Experience: {exp}
Description:
{(job.description or "")[: config.parsing.expected_answer_jd_chars]}"""


async def generate_expected_points(question_text: str, job: Any, api_key: str) -> list[str]:
    """Generate expected answer bullet points for one interview question."""
    if not (question_text or "").strip():
        return []

    from app.services.mock_external import mock_expected_points, mock_openai_enabled

    if mock_openai_enabled():
        return mock_expected_points(question_text)

    if not (api_key or "").strip():
        logger.warning("OpenAI API key not set; skipping expected_points generation")
        return []

    client = AsyncOpenAI(api_key=api_key)
    user_content = build_expected_points_user_prompt(
        _job_context(job),
        derive_difficulty_hint(job),
        question_text,
    )

    try:
        model_cfg = config.models.expected_answer
        response = await client.chat.completions.create(
            model=model_cfg.name,
            messages=[
                {"role": "system", "content": EXPECTED_POINTS_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format=model_cfg.openai_response_format(),
            temperature=model_cfg.temperature,
            max_tokens=model_cfg.max_tokens,
        )
        data = json.loads(response.choices[0].message.content or "{}")
        raw = data.get("expected_points") or []
        if not isinstance(raw, list):
            return []
        points = [str(p).strip() for p in raw if str(p).strip()]
        max_points = config.parsing.expected_answer_max_points
        return points[:max_points] if points else []
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
    api_key: str,
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
            expected_points = await generate_expected_points(question, job, api_key)
        else:
            raw_points = old.get("expected_points") if old else None
            if isinstance(raw_points, list):
                expected_points = [str(p).strip() for p in raw_points if str(p).strip()]
            else:
                expected_points = await generate_expected_points(question, job, api_key)

        enriched.append({
            "id": qid,
            "question": question,
            "score": score,
            "expected_points": expected_points or None,
        })

    return enriched
