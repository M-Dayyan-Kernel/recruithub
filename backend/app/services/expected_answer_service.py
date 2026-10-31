"""Generate hidden expected answer points for interview questions."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.clients import mocks, openai_client
from app.core.config_loader import config
from app.prompts.common import seniority_guidance, seniority_label
from app.prompts.expected_answer import (
    EXPECTED_POINTS_SYSTEM_PROMPT,
    build_expected_points_user_prompt,
)

logger = logging.getLogger(__name__)


def _job_context(job: Any) -> str:
    skills = ", ".join(job.required_skills or []) or "Not specified"
    return f"""Title: {job.title}
Required Skills: {skills}
Seniority: {seniority_label(job.seniority_level)}
Description:
{(job.description or "")[: config.parsing.expected_answer_jd_chars]}"""


class ExpectedAnswerService:
    """Writes the hidden answer key (expected points) for one interview question."""

    async def generate(self, question_text: str, job: Any, api_key: str) -> list[str]:
        return await self._generate_expected_points(question_text, job, api_key)

    async def _generate_expected_points(
        self, question_text: str, job: Any, api_key: str
    ) -> list[str]:
        if not (question_text or "").strip():
            return []

        if mocks.mock_openai_enabled():
            return mocks.mock_expected_points(question_text)

        if not (api_key or "").strip():
            logger.warning("OpenAI API key not set; skipping expected_points generation")
            return []

        user_content = build_expected_points_user_prompt(
            _job_context(job),
            seniority_guidance(job.seniority_level),
            question_text,
        )

        try:
            content = await openai_client().chat_completion_json(
                "expected_answer",
                [
                    {"role": "system", "content": EXPECTED_POINTS_SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                api_key=api_key,
            )
            data = json.loads(content or "{}")
            raw = data.get("expected_points") or []
            if not isinstance(raw, list):
                return []
            points = [str(p).strip() for p in raw if str(p).strip()]
            max_points = config.parsing.expected_answer_max_points
            return points[:max_points] if points else []
        except Exception:
            logger.exception("Failed to generate expected_points for question")
            return []


async def generate_expected_points(question_text: str, job: Any, api_key: str) -> list[str]:
    return await ExpectedAnswerService()._generate_expected_points(
        question_text, job, api_key
    )
