"""
Constraints for voice-only interviews (no IDE, compiler, or live coding).
"""

import re
from typing import Optional

# Shared LLM instruction block — include in question-generation prompts.
ORAL_ONLY_PROMPT_RULES = """
ORAL / VOICE-ONLY INTERVIEW RULES (mandatory):
- This platform is a spoken voice interview only. There is NO code editor, compiler, interpreter, whiteboard, or screen share.
- Every question must be answerable by talking: explaining concepts, describing past experience, trade-offs, architecture, debugging approach, or how they would handle a situation.
- NEVER ask the candidate to write code, type syntax, run a program, solve a live coding puzzle, complete a coding exercise, or share their screen.
- Prefer: "Explain how you...", "Describe a time when...", "Walk me through...", "What approach would you take to..."
- Avoid: "Write a function...", "Implement...", "Code this...", "Solve this algorithm...", "Demonstrate X with a coding exercise"
"""

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


def question_requires_live_coding(question: str) -> bool:
    """Return True if question text implies live coding or a non-oral task."""
    text = (question or "").strip()
    if not text:
        return False
    return any(pattern.search(text) for pattern in _CODING_QUESTION_PATTERNS)


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


def validate_oral_interview_questions(questions: Optional[list]) -> None:
    """Validate all interview questions in a rubric list."""
    if not questions:
        return
    for item in questions:
        if isinstance(item, dict):
            text = (item.get("question") or "").strip()
        else:
            text = getattr(item, "question", "") or ""
        validate_oral_interview_question(text)
