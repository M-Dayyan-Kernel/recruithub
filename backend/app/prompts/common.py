"""Shared instruction blocks composed into multiple interview prompts."""

from app.models.enums import SeniorityLevel

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

SENIORITY_GUIDANCE: dict[SeniorityLevel, str] = {
    SeniorityLevel.INTERN: (
        "Intern: core fundamentals and concepts, basic tool usage, learning attitude shown through "
        "small-scope examples. Do not expect production experience."
    ),
    SeniorityLevel.JUNIOR: (
        "Junior: fundamentals, definitions, basic usage, simple trade-offs, small-scope examples."
    ),
    SeniorityLevel.MID: (
        "Mid-level: applied experience, component design, debugging real scenarios, "
        "tool/framework choices, moderate depth."
    ),
    SeniorityLevel.SENIOR: (
        "Senior: system design, scalability, reliability, ownership, cross-service trade-offs, "
        "deep expertise in the core stack."
    ),
}

DIFFICULTY_TIER_GUIDANCE = "DIFFICULTY CALIBRATION (match the role's seniority level):\n" + "\n".join(
    f"- {text}" for text in SENIORITY_GUIDANCE.values()
)


def seniority_label(level: str | SeniorityLevel | None) -> str:
    """Human/LLM-readable seniority, e.g. "Mid-level"."""
    value = SeniorityLevel(level) if level else SeniorityLevel.MID
    return "Mid-level" if value is SeniorityLevel.MID else value.value.capitalize()


def seniority_guidance(level: str | SeniorityLevel | None) -> str:
    """One line of difficulty guidance for the job's seniority, for user-message prompts."""
    value = SeniorityLevel(level) if level else SeniorityLevel.MID
    return f"Difficulty tier: {SENIORITY_GUIDANCE[value]}"
