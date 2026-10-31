"""A job's interview topic pool: writing it, replacing one topic, and saving it.

A topic says what to probe; each interview asks a few of them in its own words
(see interview_plan_service). The pool is generated from the job description, then HR reviews it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Awaitable, Callable, Optional

from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients import mocks, openai_client
from app.core.config_loader import config
from app.exceptions import JobParseFailedError, UpstreamError
from app.models.models import Job, JobInterviewTopic
from app.prompts.interview_topics import pool_messages, replace_messages
from app.schemas.schemas import InterviewTopicIn

logger = logging.getLogger(__name__)

#: Answer keys written at once when a pool is saved: enough to be quick, few enough not to trip
#: the provider's rate limit.
_ANSWER_KEY_CONCURRENCY = 5

GeneratePoints = Callable[[str, Any, str], Awaitable[list[str]]]


def normalize_generated_topics(raw: Any) -> list[dict]:
    """The usable topics from a model's answer: valid, distinct by name, none mandatory.

    The model is held to the rules by the prompt, not trusted: a topic that breaks one (a coding
    question, an empty field, a repeated name) is dropped rather than failing the whole pool.
    """
    topics: list[dict] = []
    seen: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            topic = InterviewTopicIn.model_validate(
                {key: item.get(key) or "" for key in ("name", "scope", "skill_tag", "seed_question")}
            )
        except (PydanticValidationError, ValueError) as exc:
            logger.warning("Dropped a generated interview topic (%s): %r", exc, item.get("name"))
            continue
        key = topic.name.lower()
        if key in seen:
            continue
        seen.add(key)
        topics.append({**topic.model_dump(exclude={"id"}), "is_mandatory": False})
    return topics[: config.parsing.topic_pool.max]


async def _ask_for(workload_messages: list[dict], api_key: str) -> dict:
    content = await openai_client().chat_completion_json(
        "interview_topics", workload_messages, api_key=api_key
    )
    data = json.loads(content or "{}")
    return data if isinstance(data, dict) else {}


async def generate_pool(
    *,
    title: str,
    description: str,
    required_skills: list[str],
    seniority_level: str,
    api_key: str,
) -> list[dict]:
    """Write a fresh topic pool for a job (saved or not)."""
    if mocks.mock_openai_enabled():
        return normalize_generated_topics(mocks.mock_interview_topics(config.parsing.topic_pool.size))
    data = await _ask_for(pool_messages(title, description, required_skills, seniority_level), api_key)
    topics = normalize_generated_topics(data.get("topics"))
    if not topics:
        raise JobParseFailedError(
            public_message="Could not write interview topics for this job. Try again, or add them by hand."
        )
    return topics


async def regenerate_topic(
    *,
    title: str,
    description: str,
    required_skills: list[str],
    seniority_level: str,
    pool: list[dict],
    index: int,
    api_key: str,
) -> dict:
    """A replacement for pool[index]: same skill area, different angle. Keeps its id and mandatory mark."""
    replacing = pool[index]
    if mocks.mock_openai_enabled():
        taken = {t["name"].lower() for t in pool}
        candidates = [
            t for t in normalize_generated_topics(mocks.mock_interview_topics()) if t["name"].lower() not in taken
        ]
        raw: dict = candidates[0] if candidates else {}
    else:
        data = await _ask_for(
            replace_messages(
                title, description, required_skills, seniority_level, pool=pool, replacing=replacing
            ),
            api_key,
        )
        raw = data.get("topic") if isinstance(data.get("topic"), dict) else {}
    others = {t["name"].lower() for i, t in enumerate(pool) if i != index}
    fresh = [t for t in normalize_generated_topics([raw]) if t["name"].lower() not in others]
    if not fresh:
        raise JobParseFailedError(public_message="Could not write a replacement topic. Try again.")
    return {**fresh[0], "id": replacing.get("id"), "is_mandatory": bool(replacing.get("is_mandatory"))}


async def replace_topics(
    db: AsyncSession,
    job: Job,
    incoming: list[dict],
    *,
    generate_points: GeneratePoints,
    api_key: Optional[str],
) -> None:
    """Make the job's pool exactly `incoming`, in that order.

    A topic is matched by id. One whose example question is unchanged keeps its answer key; a new
    or reworded one gets a fresh key. Topics missing from `incoming` are deleted: plan items that
    used them keep their own copy of the question and topic name.
    """
    existing = {topic.id: topic for topic in job.interview_topics}
    kept: list[JobInterviewTopic] = []
    needs_key: list[JobInterviewTopic] = []
    for position, item in enumerate(incoming):
        topic = existing.get(item.get("id"))
        if topic is None:
            topic = JobInterviewTopic(id=item.get("id") or uuid.uuid4(), job_id=job.id)
            needs_key.append(topic)
        elif topic.seed_question != item["seed_question"] or not topic.seed_expected_points:
            needs_key.append(topic)
        topic.position = position
        topic.name = item["name"]
        topic.scope = item["scope"]
        topic.skill_tag = item["skill_tag"]
        topic.seed_question = item["seed_question"]
        topic.is_mandatory = bool(item.get("is_mandatory"))
        kept.append(topic)

    if needs_key:
        gate = asyncio.Semaphore(_ANSWER_KEY_CONCURRENCY)

        async def write_key(topic: JobInterviewTopic) -> None:
            async with gate:
                points = await generate_points(topic.seed_question, job, api_key or "")
            topic.seed_expected_points = points or None

        await asyncio.gather(*(write_key(topic) for topic in needs_key))
        # Every topic must have an answer key: an interview scores its questions by how many of
        # those points the candidate covered.
        missing = [topic.name for topic in needs_key if not topic.seed_expected_points]
        if missing:
            raise UpstreamError(
                public_message=f"Could not write the answer key for: {', '.join(missing)}. Try saving again."
            )

    # Reassigning the collection removes the topics left out (delete-orphan).
    job.interview_topics = kept
    await db.flush()
