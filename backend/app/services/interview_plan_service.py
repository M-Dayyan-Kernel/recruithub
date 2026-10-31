"""What an interview asks: choosing topics from the job's pool and building the plan.

Every interview has a plan of items (the introduction, then topics), each with the question to
ask, its answer key, and its share of the 100 points. The agent asks from the plan and the
assessment scores against it, so the report shows exactly what this candidate was asked.

A job with no topics has no plan, and its interviews keep the generic prompt and the 0-100
dimension scoring.
"""

from __future__ import annotations

import logging
import random
import uuid
from collections import Counter
from typing import Iterable, Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.models.enums import PlanSection, PlanStatus
from app.models.models import InterviewPlanItem, InterviewSession, Job, JobInterviewTopic

logger = logging.getLogger(__name__)

#: Asked in this order.
SECTION_ORDER = (PlanSection.INTRO, PlanSection.PROJECT, PlanSection.TOPIC)
INTRO_TOPIC_NAME = "Introduction"


def select_topics(
    pool: Sequence[JobInterviewTopic],
    *,
    prior_topic_ids: Iterable[uuid.UUID] = (),
    usage: Optional[dict[uuid.UUID, int]] = None,
    count: Optional[int] = None,
    max_per_skill: Optional[int] = None,
    rng: Optional[random.Random] = None,
) -> list[JobInterviewTopic]:
    """Pick the topics for one interview, in the order they will be asked.

    Mandatory topics always come. The rest are preferred in this order: not asked in an earlier
    round of this candidate's, then least used across the job (so a campus batch spreads over the
    whole pool), ties broken at random. No more than `max_per_skill` share a skill tag; that cap
    gives way only when the pool cannot fill the interview otherwise. A pool smaller than the
    interview is asked in full.
    """
    rng = rng or random.Random()
    wanted = min(count or config.interview.plan.topics_per_round, len(pool))
    cap = max_per_skill or config.interview.plan.max_per_skill
    prior = set(prior_topic_ids)
    usage = usage or {}

    chosen: list[JobInterviewTopic] = [t for t in pool if t.is_mandatory][:wanted]
    skills = Counter(t.skill_tag for t in chosen)

    def order(topics: list[JobInterviewTopic]) -> list[JobInterviewTopic]:
        return sorted(topics, key=lambda t: (usage.get(t.id, 0), rng.random()))

    rest = [t for t in pool if t not in chosen]
    # Topics this candidate has not been asked first; the rest only to fill a short pool.
    ranked = order([t for t in rest if t.id not in prior]) + order([t for t in rest if t.id in prior])

    deferred: list[JobInterviewTopic] = []
    for topic in ranked:
        if len(chosen) >= wanted:
            break
        if skills[topic.skill_tag] >= cap:
            deferred.append(topic)
            continue
        chosen.append(topic)
        skills[topic.skill_tag] += 1
    for topic in deferred:
        if len(chosen) >= wanted:
            break
        chosen.append(topic)

    rng.shuffle(chosen)
    return chosen


def allocate_points(item_counts: dict[PlanSection, int]) -> dict[PlanSection, list[int]]:
    """Split the 100 points over the sections that have items, then over each section's items.

    A section with no items hands its weight to the topics (or, with no topics, to the heaviest
    section left), so the plan always totals 100. Within a section the points are equal and the
    last item takes the remainder.
    """
    weights = {
        PlanSection.INTRO: config.interview.plan.weights.intro,
        PlanSection.PROJECT: config.interview.plan.weights.project,
        PlanSection.TOPIC: config.interview.plan.weights.topic,
    }
    present = {section: n for section, n in item_counts.items() if n > 0}
    if not present:
        return {}
    shares = {section: weights[section] for section in present}
    unused = sum(weight for section, weight in weights.items() if section not in present)
    receiver = PlanSection.TOPIC if PlanSection.TOPIC in present else max(present, key=lambda s: weights[s])
    shares[receiver] += unused

    allocation: dict[PlanSection, list[int]] = {}
    for section, n in present.items():
        base = shares[section] // n
        allocation[section] = [base] * (n - 1) + [shares[section] - base * (n - 1)]
    return allocation


def seeded_items(topics: Sequence[JobInterviewTopic]) -> list[dict]:
    """The plan as plain values: the introduction, then each topic as its seed question."""
    intro = {
        "section": PlanSection.INTRO,
        "topic_id": None,
        "topic_name": INTRO_TOPIC_NAME,
        "question": " ".join(config.interview.plan.intro_question.split()),
        "expected_points": list(config.interview.plan.intro_expected_points),
    }
    items = [intro] + [
        {
            "section": PlanSection.TOPIC,
            "topic_id": topic.id,
            "topic_name": topic.name,
            "question": topic.seed_question,
            "expected_points": list(topic.seed_expected_points or []),
        }
        for topic in topics
    ]
    counts = Counter(item["section"] for item in items)
    points = allocate_points(dict(counts))
    cursor = {section: 0 for section in points}
    for position, item in enumerate(items):
        section = item["section"]
        item["position"] = position
        item["points"] = points[section][cursor[section]]
        cursor[section] += 1
    return items


async def _prior_topic_ids(db: AsyncSession, session: InterviewSession) -> set[uuid.UUID]:
    """Topics already asked in this candidate's other rounds, voided ones included."""
    rows = await db.execute(
        select(InterviewPlanItem.topic_id)
        .join(InterviewSession, InterviewSession.id == InterviewPlanItem.session_id)
        .where(
            InterviewSession.candidate_id == session.candidate_id,
            InterviewSession.job_id == session.job_id,
            InterviewSession.id != session.id,
            InterviewPlanItem.topic_id.is_not(None),
        )
    )
    return set(rows.scalars().all())


async def _topic_usage(db: AsyncSession, job_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """How many interviews of this job have been given each topic."""
    rows = await db.execute(
        select(InterviewPlanItem.topic_id, func.count())
        .join(InterviewSession, InterviewSession.id == InterviewPlanItem.session_id)
        .where(InterviewSession.job_id == job_id, InterviewPlanItem.topic_id.is_not(None))
        .group_by(InterviewPlanItem.topic_id)
    )
    return {topic_id: n for topic_id, n in rows.all()}


async def ensure_plan(
    db: AsyncSession, session: InterviewSession, *, rng: Optional[random.Random] = None
) -> bool:
    """Give the interview its plan if it has none. Safe to call again: a built plan is kept.

    Returns whether a plan was built. A job with no topics gets none. The caller commits.
    """
    if session.plan_status != PlanStatus.PENDING.value:
        return False
    job = await db.get(Job, session.job_id)
    if job is None or not job.interview_topics:
        return False

    topics = select_topics(
        job.interview_topics,
        prior_topic_ids=await _prior_topic_ids(db, session),
        usage=await _topic_usage(db, job.id),
        rng=rng,
    )
    for item in seeded_items(topics):
        db.add(
            InterviewPlanItem(
                session_id=session.id,
                position=item["position"],
                section=item["section"].value,
                topic_id=item["topic_id"],
                topic_name=item["topic_name"],
                question=item["question"],
                expected_points=item["expected_points"],
                points=item["points"],
            )
        )
    session.plan_status = PlanStatus.SEEDED.value
    await db.flush()
    logger.info("Built interview plan for session=%s with %d topics", session.id, len(topics))
    return True


async def load_plan_items(db: AsyncSession, session_id: uuid.UUID) -> list[InterviewPlanItem]:
    rows = await db.execute(
        select(InterviewPlanItem)
        .where(InterviewPlanItem.session_id == session_id)
        .order_by(InterviewPlanItem.position)
    )
    return list(rows.scalars().all())


def plan_as_rubric(items: Iterable[InterviewPlanItem]) -> list[dict]:
    """The plan in the shape the assessment scores against."""
    return [
        {
            "id": str(item.id),
            "question": item.question,
            "score": item.points,
            "expected_points": list(item.expected_points or []),
            "section": item.section,
            "topic": item.topic_name,
        }
        for item in items
    ]


async def load_rubric(db: AsyncSession, session_id: uuid.UUID) -> list[dict]:
    """The interview's rubric; empty when it has no plan (the legacy dimension scoring applies)."""
    return plan_as_rubric(await load_plan_items(db, session_id))
