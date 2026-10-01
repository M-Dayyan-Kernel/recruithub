"""Shared instruction blocks composed into multiple interview prompts."""

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
