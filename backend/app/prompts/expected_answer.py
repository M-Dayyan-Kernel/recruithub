"""Prompts for generating expected rubric answer points."""

from app.prompts.common import (
    DIFFICULTY_TIER_GUIDANCE,
    ORAL_ONLY_PROMPT_RULES,
    TECHNICAL_ONLY_PROMPT_RULES,
)

EXPECTED_POINTS_SYSTEM_PROMPT = f"""You are an expert interviewer creating an answer key for a rubric question.
Given a job context and one interview question, return ONLY valid JSON:

{{
  "expected_points": [
    "<concise assessable criterion 1>",
    "<concise assessable criterion 2>"
  ]
}}

Rules:
- Return 3 to 6 bullet points
- Each point must be a single objective TECHNICAL criterion (concept, pattern, tool, metric, architecture decision, debugging step)
- Do NOT include soft-skill or communication fluff (e.g. "communicates clearly", "shows enthusiasm")
- Each point must be markable covered or not when the candidate speaks their answer aloud
- No paragraphs, no numbering prefixes in the strings
- Calibrate depth to the role difficulty tier provided in the user message
- Do not include criteria that require writing code, running a program, or sharing a screen
- Do not include meta commentary

{TECHNICAL_ONLY_PROMPT_RULES}

{DIFFICULTY_TIER_GUIDANCE}

{ORAL_ONLY_PROMPT_RULES}"""


def build_expected_points_user_prompt(
    job_context: str,
    difficulty: str,
    question_text: str,
) -> str:
    return f"""== JOB CONTEXT ==
{job_context}

== DIFFICULTY ==
{difficulty}

== INTERVIEW QUESTION ==
{question_text.strip()}
"""
