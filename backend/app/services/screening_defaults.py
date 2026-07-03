"""Default screening call questions applied to every job."""

import uuid
from copy import deepcopy

# Stable ids so defaults are recognizable across jobs
_DEFAULT_TEMPLATES: list[tuple[str, str]] = [
    (
        "screening-default-availability",
        "When are you available to start a new role? Are you currently looking actively?",
    ),
    (
        "screening-default-employment",
        "Are you currently employed? What is your current role and company?",
    ),
    (
        "screening-default-experience",
        "Can you briefly describe your most relevant experience for this {job_title} role?",
    ),
    (
        "screening-default-current-ctc",
        "What is your current compensation package (annual CTC)?",
    ),
    (
        "screening-default-expected-ctc",
        "What are your salary expectations for this role?",
    ),
    (
        "screening-default-notice",
        "What is your notice period at your current company?",
    ),
    (
        "screening-default-location",
        "What is your remote, hybrid, or on-site preference?",
    ),
    (
        "screening-default-interest",
        "Are you interested in moving forward with this opportunity?",
    ),
]


def get_default_screening_questions(job_title: str = "this") -> list[dict]:
    """Return default screening questions with optional job title substitution."""
    title = (job_title or "this").strip() or "this"
    return [
        {
            "id": qid,
            "question": text.replace("{job_title}", title),
        }
        for qid, text in _DEFAULT_TEMPLATES
    ]


def merge_screening_questions(
    existing: list | None,
    additional: list | None,
    job_title: str = "",
) -> list[dict]:
    """Merge defaults + existing + JD-parsed questions, deduping by normalized text."""
    base = get_default_screening_questions(job_title) if not existing else deepcopy(existing)
    seen = {(q.get("question") or "").strip().lower() for q in base if isinstance(q, dict)}

    for item in additional or []:
        if not isinstance(item, dict):
            continue
        question = (item.get("question") or "").strip()
        if not question:
            continue
        key = question.lower()
        if key in seen:
            continue
        seen.add(key)
        base.append({
            "id": item.get("id") or str(uuid.uuid4()),
            "question": question,
        })

    return base


def format_screening_questions_for_prompt(questions: list | None, job_title: str = "") -> str:
    """Format screening questions as a numbered list for voice agent prompts."""
    merged = merge_screening_questions(questions, None, job_title) if not questions else questions
    lines = []
    for i, q in enumerate(merged, start=1):
        if not isinstance(q, dict):
            continue
        text = (q.get("question") or "").strip()
        if text:
            lines.append(f"{i}. {text}")
    return "\n".join(lines)
