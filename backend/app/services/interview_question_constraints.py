"""
Constraints for voice-only, technical interview questions.
"""

import re
from typing import Optional

from app.prompts.common import (
    ORAL_ONLY_PROMPT_RULES,
    TECHNICAL_ONLY_PROMPT_RULES,
)

# Patterns that indicate a question requires live coding / non-oral assessment.
_CODING_QUESTION_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bwrite\s+(a\s+)?(code|function|program|script|query|sql)\b",
        r"\b(coding|code)\s+exercise\b",
        r"\blive\s+cod(e|ing)\b",
        r"\bimplement\s+(a\s+)?(function|class|algorithm|solution|program)\b",
        r"\bsolve\s+this\s+(problem|algorithm|leetcode)\b",
        r"\bleetcode\b",
        r"\bwhiteboard\s+cod(e|ing)\b",
        r"\bshare\s+your\s+screen\b",
        r"\b(run|execute|compile)\s+(the\s+)?(code|program|script)\b",
        r"\btype\s+(the\s+)?(code|solution)\b",
        r"\bdebug\s+this\s+(code|snippet|program)\b",
        r"\bdemonstrate\s+.+\s+with\s+a\s+coding\b",
        r"\bcomplete\s+(the\s+)?(following\s+)?(exercise|challenge)\b",
        r"\bpair[\s-]?program",
        r"\bhackerrank\b",
        r"\bcodility\b",
    )
)

_BEHAVIOURAL_QUESTION_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\btell\s+me\s+about\s+a\s+time\b",
        r"\bdescribe\s+a\s+(situation|time)\s+when\s+you\b",
        r"\bgive\s+me\s+an\s+example\s+of\s+(a\s+)?(time|situation)\b",
        r"\bhow\s+do\s+you\s+handle\s+conflict\b",
        r"\bconflict\s+with\s+(a\s+)?(coworker|colleague|teammate|manager)\b",
        r"\bleadership\s+style\b",
        r"\bgreatest\s+(strength|weakness)\b",
        r"\bwhy\s+(do\s+you\s+want|should\s+we\s+hire)\b",
        r"\bwhere\s+do\s+you\s+see\s+yourself\b",
        r"\bculture\s+fit\b",
        r"\bwork[\s-]?life\s+balance\b",
        r"\bteam\s+dynamics\b",
        r"\binterpersonal\b",
        r"\bsoft\s+skill\b",
        r"\bpersonality\b",
        r"\bstar\s+method\b",
    )
)


def question_requires_live_coding(question: str) -> bool:
    """Return True if question text implies live coding or a non-oral task."""
    text = (question or "").strip()
    if not text:
        return False
    return any(pattern.search(text) for pattern in _CODING_QUESTION_PATTERNS)


def question_is_behavioural(question: str) -> bool:
    """Return True if question text is primarily behavioural/soft-skill."""
    text = (question or "").strip()
    if not text:
        return False
    return any(pattern.search(text) for pattern in _BEHAVIOURAL_QUESTION_PATTERNS)


def validate_oral_interview_question(question: str, *, field_label: str = "Interview question") -> None:
    """Raise ValueError if the question is not suitable for a voice-only interview."""
    text = (question or "").strip()
    if not text:
        return
    if question_requires_live_coding(text):
        raise ValueError(
            f"{field_label} must be answerable orally in a voice interview "
            f"(no live coding, writing code, or screen sharing). "
            f"Rephrase to ask for an explanation or past experience instead. "
            f"Problem: \"{text[:120]}{'…' if len(text) > 120 else ''}\""
        )


def validate_technical_interview_question(question: str, *, field_label: str = "Interview question") -> None:
    """Raise ValueError if the question is not technical."""
    text = (question or "").strip()
    if not text:
        return
    if question_is_behavioural(text):
        raise ValueError(
            f"{field_label} must be technical (stack, architecture, debugging, system design, tools). "
            f"Behavioural and soft-skill questions are not allowed. "
            f"Problem: \"{text[:120]}{'…' if len(text) > 120 else ''}\""
        )


def validate_interview_question(question: str, *, field_label: str = "Interview question") -> None:
    """Run all interview question validators."""
    validate_oral_interview_question(question, field_label=field_label)
    validate_technical_interview_question(question, field_label=field_label)


def validate_oral_interview_questions(questions: Optional[list]) -> None:
    """Validate all interview questions in a rubric list."""
    if not questions:
        return
    for item in questions:
        if isinstance(item, dict):
            text = (item.get("question") or "").strip()
        else:
            text = getattr(item, "question", "") or ""
        validate_interview_question(text)
