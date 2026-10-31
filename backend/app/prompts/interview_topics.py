"""Prompts for writing a job's interview topic pool, and one replacement topic."""

from app.core.config_loader import config
from app.prompts.common import (
    ORAL_ONLY_PROMPT_RULES,
    TECHNICAL_ONLY_PROMPT_RULES,
    seniority_guidance,
)

TOPIC_SHAPE = """{
  "name": "<short topic name, up to 6 words>",
  "scope": "<one or two sentences on what the interviewer should probe>",
  "skill_tag": "<the one skill or area this topic tests, lowercase, e.g. 'postgresql' or 'api design'>",
  "seed_question": "<one question to ask aloud on this topic>"
}"""


def topic_pool_rules(size: int) -> str:
    """The rules a pool must follow, shared by the JD parse and the pool generator."""
    return f"""TOPIC POOL RULES (mandatory):
- Write exactly {size} topics. A topic is something to probe, not a fixed script: later, each interview
  asks a few of them in different words, so every topic must stand on its own.
- Cover the whole role. Every required skill appears in at least one topic's skill_tag, no skill has more
  than 3 topics, and the rest of the pool spans what the job does (data, APIs, testing, debugging,
  performance, security, architecture as the role calls for).
- All topics are the same difficulty, the seniority level given. No topic is clearly easier or harder than the others.
- Topic names are unique. skill_tag is a short lowercase phrase; reuse a required skill's own name when the
  topic is about that skill.
- seed_question is a single question that can be answered by talking.

{TECHNICAL_ONLY_PROMPT_RULES}
{ORAL_ONLY_PROMPT_RULES}"""


def _pool_system_prompt() -> str:
    size = config.parsing.topic_pool.size
    return f"""You write the interview topic pool for a job. Return ONLY valid JSON:

{{"topics": [{TOPIC_SHAPE}, ...]}}

{topic_pool_rules(size)}"""


def _replace_system_prompt() -> str:
    return f"""You replace one topic in a job's interview topic pool. Return ONLY valid JSON:

{{"topic": {TOPIC_SHAPE}}}

Rules:
- The new topic stays in the same skill area as the topic being replaced, but probes a different angle,
  and its name differs from every topic already in the pool.
- It is the same difficulty as the rest of the pool (the seniority level given).
- seed_question is a single question that can be answered by talking.

{TECHNICAL_ONLY_PROMPT_RULES}
{ORAL_ONLY_PROMPT_RULES}"""


def _job_context(title: str, description: str, required_skills: list[str], seniority_level: str) -> str:
    skills = ", ".join(required_skills) or "Not specified"
    return (
        f"Title: {title}\n"
        f"Required skills: {skills}\n"
        f"{seniority_guidance(seniority_level)}\n"
        f"Description:\n{description[: config.parsing.expected_answer_jd_chars]}"
    )


def pool_messages(title: str, description: str, required_skills: list[str], seniority_level: str) -> list[dict]:
    return [
        {"role": "system", "content": _pool_system_prompt()},
        {"role": "user", "content": _job_context(title, description, required_skills, seniority_level)},
    ]


def replace_messages(
    title: str,
    description: str,
    required_skills: list[str],
    seniority_level: str,
    *,
    pool: list[dict],
    replacing: dict,
) -> list[dict]:
    names = "\n".join(f"- {t['name']} ({t['skill_tag']})" for t in pool)
    return [
        {"role": "system", "content": _replace_system_prompt()},
        {
            "role": "user",
            "content": (
                f"{_job_context(title, description, required_skills, seniority_level)}\n\n"
                f"== TOPICS ALREADY IN THE POOL ==\n{names}\n\n"
                f"== TOPIC TO REPLACE ==\n{replacing['name']} ({replacing['skill_tag']}): {replacing['scope']}\n"
            ),
        },
    ]
