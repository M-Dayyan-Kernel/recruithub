"""
Constraints for voice-only, technical interview questions.
"""

import re
from typing import Any, Optional

# Shared LLM instruction block — include in question-generation prompts.
ORAL_ONLY_PROMPT_RULES = """
ORAL / VOICE-ONLY INTERVIEW RULES (mandatory):
- This platform is a spoken voice interview only. There is NO code editor, compiler, interpreter, whiteboard, or screen share.
- Every question must be answerable by talking: explaining concepts, describing past experience, trade-offs, architecture, debugging approach, or how they would handle a situation.
- NEVER ask the candidate to write code, type syntax, run a program, solve a live coding puzzle, complete a coding exercise, or share their screen.
- Prefer: "Explain how you...", "Walk me through...", "What approach would you take to...", "How would you design..."
- Avoid: "Write a function...", "Implement...", "Code this...", "Solve this algorithm...", "Demonstrate X with a coding exercise"
"""

TECHNICAL_ONLY_PROMPT_RULES = """
TECHNICAL-ONLY RULES (mandatory):
- Every interview question must assess technical skill: stack, tools, architecture, debugging, system design, data, APIs, performance, security, or hands-on engineering judgment.
- Do NOT generate behavioural, soft-skill, culture-fit, or HR questions (e.g. conflict resolution, leadership style, strengths/weaknesses, motivation, teamwork stories without technical depth).
- Do NOT ask "tell me about yourself" or role-interest questions in the rubric — those are handled separately in the live interview intro.
- Prefer questions tied to required_skills and the job description.
- Each question must have a technically assessable answer (concepts, decisions, trade-offs, tools, patterns).
"""

DIFFICULTY_TIER_GUIDANCE = """
DIFFICULTY CALIBRATION (match role and JD experience):
- Junior (0–2 years): fundamentals, definitions, basic usage, simple trade-offs, small-scope examples
- Mid-level (3–5 years): applied experience, component design, debugging real scenarios, tool/framework choices, moderate depth
- Senior (5+ years or lead/architect/principal titles): system design, scalability, reliability, ownership, cross-service trade-offs, deep expertise in core stack
"""

_SENIOR_TITLE_HINTS = (
    "senior", "lead", "principal", "staff", "architect", "head", "director", "manager",
)
_JUNIOR_TITLE_HINTS = (
    "intern", "graduate", "junior", "entry", "trainee", "associate",
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


def _title_lower(title: str) -> str:
    return (title or "").strip().lower()


def derive_difficulty_hint(
    job: Any = None,
    *,
    title: str = "",
    experience_min: Optional[int] = None,
    experience_max: Optional[int] = None,
) -> str:
    """Return a prompt-friendly difficulty tier from role title and experience range."""
    if job is not None:
        title = getattr(job, "title", None) or title
        experience_min = getattr(job, "experience_min", experience_min)
        experience_max = getattr(job, "experience_max", experience_max)

    title_l = _title_lower(title)
    exp_min = int(experience_min or 0)
    exp_max = int(experience_max or 0)

    if any(hint in title_l for hint in _SENIOR_TITLE_HINTS):
        tier = "Senior"
        guidance = (
            "Ask for system design, scalability, reliability, deep stack expertise, "
            "and cross-component technical trade-offs."
        )
    elif any(hint in title_l for hint in _JUNIOR_TITLE_HINTS):
        tier = "Junior"
        guidance = (
            "Ask for fundamentals, core concepts, basic tool usage, and simple practical trade-offs."
        )
    elif exp_max > 0 and exp_max <= 2:
        tier = "Junior"
        guidance = (
            "Ask for fundamentals, core concepts, basic tool usage, and simple practical trade-offs."
        )
    elif exp_min >= 5 or exp_max > 5:
        tier = "Senior"
        guidance = (
            "Ask for system design, scalability, reliability, deep stack expertise, "
            "and cross-component technical trade-offs."
        )
    elif (exp_min >= 3 and exp_min < 5) or (exp_max >= 3 and exp_max <= 5):
        tier = "Mid-level"
        guidance = (
            "Ask for applied experience, component-level design, debugging, and moderate-depth "
            "technical decisions."
        )
    elif exp_min > 0 and exp_min < 3:
        tier = "Junior"
        guidance = (
            "Ask for fundamentals, core concepts, basic tool usage, and simple practical trade-offs."
        )
    else:
        tier = "Mid-level"
        guidance = (
            "Ask for applied experience, component-level design, debugging, and moderate-depth "
            "technical decisions."
        )

    exp_label = f"{exp_min}–{exp_max} years" if exp_max > 0 else f"{exp_min}+ years"
    return f"Difficulty tier: {tier} ({title or 'role'}, {exp_label}). {guidance}"


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
