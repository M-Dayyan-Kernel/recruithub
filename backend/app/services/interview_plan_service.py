"""What an interview asks: choosing topics from the job's pool and building the plan.

Every interview has a plan of items (the introduction, then topics), each with the question to
ask, its answer key, and its share of the 100 points. The agent asks from the plan and the
assessment scores against it, so the report shows exactly what this candidate was asked.

A plan starts "seeded": the introduction and each topic's own example question, ready to
interview on. `generate_plan` then rewrites it for this candidate (each topic in a fresh angle,
plus questions about their own projects) and marks it "generated"; if that fails the seeded plan
stands.

A job with no topics has no plan, and its interviews keep the generic prompt and the 0-100
dimension scoring.
"""

from __future__ import annotations

import json
import logging
import random
import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Iterable, Optional, Sequence

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients import mocks, openai_client
from app.core.config_loader import config
from app.models.enums import PlanSection, PlanStatus
from app.models.models import (
    Candidate,
    InterviewPlanItem,
    InterviewReport,
    InterviewSession,
    Job,
    JobInterviewTopic,
)
from app.prompts.interview_plan import ANGLES, plan_messages
from app.services.interview_question_constraints import (
    validate_oral_interview_question,
    validate_technical_interview_question,
)

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


async def _lock(db: AsyncSession, session: InterviewSession) -> Optional[InterviewSession]:
    """The session row, locked and freshly read. Plan changes are decided under this lock."""
    return (
        await db.execute(
            select(InterviewSession)
            .where(InterviewSession.id == session.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalars().first()


async def ensure_plan(
    db: AsyncSession, session: InterviewSession, *, rng: Optional[random.Random] = None
) -> bool:
    """Give the interview its plan if it has none. Safe to call again, and safe to call at once
    from two requests: the row is locked, so only one builds the plan and the other sees it.

    Returns whether a plan was built. A job with no topics gets none. The caller commits.
    """
    locked = await _lock(db, session)
    if locked is None or locked.plan_status != PlanStatus.PENDING.value:
        return False
    job = await db.get(Job, locked.job_id)
    if job is None or not job.interview_topics:
        return False

    topics = select_topics(
        job.interview_topics,
        prior_topic_ids=await _prior_topic_ids(db, locked),
        usage=await _topic_usage(db, job.id),
        rng=rng,
    )
    for item in seeded_items(topics):
        db.add(
            InterviewPlanItem(
                session_id=locked.id,
                position=item["position"],
                section=item["section"].value,
                topic_id=item["topic_id"],
                topic_name=item["topic_name"],
                question=item["question"],
                expected_points=item["expected_points"],
                points=item["points"],
            )
        )
    locked.plan_status = PlanStatus.SEEDED.value
    await db.flush()
    logger.info("Built interview plan for session=%s with %d topics", locked.id, len(topics))
    return True


async def freeze_plan(db: AsyncSession, session: InterviewSession) -> bool:
    """Stop a seeded plan being rewritten, because the interview is about to start on it.

    Done under the row lock before the agent is dispatched: either the rewrite committed first
    (and the agent reads it) or it finds the plan frozen and gives up. Either way the agent asks
    exactly what the assessment will score. Returns whether it changed anything; the caller commits.
    """
    locked = await _lock(db, session)
    if locked is None or locked.plan_status != PlanStatus.SEEDED.value:
        return False
    locked.plan_status = PlanStatus.FROZEN.value
    await db.flush()
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


# ---------------------------------------------------------------------------
# Writing the questions for this candidate
# ---------------------------------------------------------------------------

#: Most projects (or roles) from the resume offered to the question writer.
_MAX_PROJECTS_OFFERED = 4
# The resume is written by the candidate and goes into prompts, so what is taken from it is short,
# flat text (no line breaks or markup to dress up as instructions) and is handed over as data.
_MAX_NAME_CHARS = 100
_MAX_DESCRIPTION_CHARS = 400
_MAX_TECHNOLOGIES = 8
_MAX_TECHNOLOGY_CHARS = 40
_QUESTION_MAX_CHARS = 600
_MAX_POINTS = 6
_MIN_POINTS = 2
_WORD = re.compile(r"[a-z0-9]+")


def _flat(value: Any, limit: int) -> str:
    """One line of plain text, cut to `limit` characters."""
    return " ".join(str(value or "").split())[:limit]


def project_material(parsed_data: Optional[dict]) -> list[dict]:
    """What the candidate's resume gives to ask about: their projects, else their roles, else nothing.

    Every field is shortened and flattened, since the candidate wrote it.
    """
    parsed_data = parsed_data or {}
    projects = [
        {
            "name": _flat(p.get("name"), _MAX_NAME_CHARS),
            "description": _flat(p.get("description"), _MAX_DESCRIPTION_CHARS),
            "technologies": [
                _flat(t, _MAX_TECHNOLOGY_CHARS) for t in (p.get("technologies") or [])[:_MAX_TECHNOLOGIES] if t
            ],
        }
        for p in parsed_data.get("projects") or []
        if isinstance(p, dict) and (p.get("name") or p.get("description"))
    ]
    projects = [p for p in projects if p["name"]]
    if projects:
        return projects[:_MAX_PROJECTS_OFFERED]
    roles = []
    for entry in parsed_data.get("experience") or []:
        if not isinstance(entry, dict) or not (entry.get("description") or "").strip():
            continue
        title, company = _flat(entry.get("title"), 60), _flat(entry.get("company"), 60)
        name = f"{title} at {company}" if title and company else title or company
        if name:
            roles.append({"name": name, "description": _flat(entry["description"], _MAX_DESCRIPTION_CHARS), "technologies": []})
    return roles[:_MAX_PROJECTS_OFFERED]


def question_similarity(a: str, b: str) -> float:
    """Word overlap between two questions, 0 (nothing shared) to 1 (the same words)."""
    left = {w for w in _WORD.findall(a.lower()) if len(w) > 2}
    right = {w for w in _WORD.findall(b.lower()) if len(w) > 2}
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def is_repeat(question: str, asked: Iterable[str]) -> bool:
    limit = config.interview.plan.similarity_threshold
    return any(question_similarity(question, earlier) >= limit for earlier in asked)


def _clean_points(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    points = [" ".join(str(p).split()) for p in raw if str(p).strip()]
    return points[:_MAX_POINTS]


def _valid_question(raw: Any) -> Optional[str]:
    """The question if it is one that can be asked aloud in a technical interview, else None."""
    question = " ".join(str(raw or "").split())
    if not question or len(question) > _QUESTION_MAX_CHARS:
        return None
    try:
        validate_oral_interview_question(question)
        validate_technical_interview_question(question)
    except ValueError:
        return None
    return question


async def _already_asked(
    db: AsyncSession, job_id: uuid.UUID, topic_ids: list[uuid.UUID], exclude_session_id: uuid.UUID
) -> dict[uuid.UUID, list[str]]:
    """The latest questions put to candidates on each topic, newest first, for the writer to avoid.

    Only questions that stand: from a rewritten plan, or from an interview that has begun. A plan
    still waiting to be rewritten (this one included) has asked nobody anything yet.
    """
    limit = config.interview.plan.avoid_history
    asked: dict[uuid.UUID, list[str]] = {topic_id: [] for topic_id in topic_ids}
    if not topic_ids or not limit:
        return asked
    rows = await db.execute(
        select(InterviewPlanItem.topic_id, InterviewPlanItem.question)
        .join(InterviewSession, InterviewSession.id == InterviewPlanItem.session_id)
        .where(
            InterviewSession.job_id == job_id,
            InterviewSession.id != exclude_session_id,
            InterviewPlanItem.topic_id.in_(topic_ids),
            or_(
                InterviewSession.plan_status.in_([PlanStatus.GENERATED.value, PlanStatus.FROZEN.value]),
                InterviewSession.status != "pending",
            ),
        )
        .order_by(InterviewSession.created_at.desc(), InterviewPlanItem.position)
    )
    for topic_id, question in rows.all():
        if len(asked[topic_id]) < limit and question not in asked[topic_id]:
            asked[topic_id].append(question)
    return asked


async def _earlier_rounds(db: AsyncSession, session: InterviewSession) -> list[dict]:
    """What this candidate's earlier rounds covered and how it went, for a later round to build on."""
    rows = await db.execute(
        select(InterviewSession.round_number, InterviewReport.raw_report)
        .join(InterviewReport, InterviewReport.interview_session_id == InterviewSession.id)
        .where(
            InterviewSession.candidate_id == session.candidate_id,
            InterviewSession.job_id == session.job_id,
            InterviewSession.id != session.id,
            InterviewSession.voided_at.is_(None),
        )
        .order_by(InterviewSession.round_number)
    )
    rounds = []
    for number, raw in rows.all():
        covered = [
            {"topic": q.get("topic"), "scored": f'{q.get("earned_score") or 0}/{q.get("score")}'}
            for q in (raw or {}).get("question_scores") or []
            if q.get("section") == PlanSection.TOPIC.value
        ]
        if covered:
            rounds.append({"round": number, "topics": covered})
    return rounds


async def _write_questions(api_key: str, **request: Any) -> dict:
    """Ask the model for this interview's questions. Raises if it is unreachable or answers badly."""
    if mocks.mock_openai_enabled():
        return mocks.mock_interview_plan(**request)
    content = await openai_client().chat_completion_json(
        "interview_plan", plan_messages(**request), api_key=api_key
    )
    data = json.loads(content or "{}")
    if not isinstance(data, dict):
        raise ValueError("the question writer did not return an object")
    return data


def _topic_answers(raw: Any) -> dict[str, dict]:
    return {
        str(item.get("topic_id")): item
        for item in raw if isinstance(item, dict) and item.get("topic_id")
    } if isinstance(raw, list) else {}


async def generate_plan(
    db: AsyncSession, session: InterviewSession, *, api_key: str, rng: Optional[random.Random] = None
) -> bool:
    """Rewrite a seeded plan for this candidate. Returns whether the plan was replaced.

    Each topic is put in a fresh angle and checked against what earlier candidates were asked on it
    (one retry when it repeats one); up to `project_questions` questions probe the candidate's own
    projects. Anything the writer gets wrong falls back to the seeded question, so the interview is
    never left without one.

    The model is asked without holding any lock (it can take a while, and a candidate may be
    starting). The plan is replaced only if, under the row lock, it is still seeded and the
    interview still has not started: `freeze_plan` is what start takes first.
    """
    rng = rng or random.Random()
    if session.status != "pending" or session.plan_status != PlanStatus.SEEDED.value:
        return False

    job = await db.get(Job, session.job_id)
    candidate = await db.get(Candidate, session.candidate_id)
    items = await load_plan_items(db, session.id)
    by_topic = {t.id: t for t in (job.interview_topics if job else [])}
    seeded_topics = [i for i in items if i.section == PlanSection.TOPIC.value]
    # A topic HR has since removed cannot be rewritten; its seeded question stays as it is.
    writable = [i for i in seeded_topics if i.topic_id in by_topic]
    if not job or not seeded_topics:
        return False

    asked = await _already_asked(db, job.id, [i.topic_id for i in writable], session.id)
    parsed = (candidate.parsed_data if candidate else None) or {}
    projects = project_material(parsed)
    wanted_projects = min(config.interview.plan.project_questions, len(projects))
    request = dict(
        title=job.title,
        seniority_level=job.seniority_level,
        topics=[
            {
                "id": str(i.topic_id), "name": by_topic[i.topic_id].name, "scope": by_topic[i.topic_id].scope,
                "angle": rng.choice(list(ANGLES)), "seed_question": by_topic[i.topic_id].seed_question,
                "already_asked": asked[i.topic_id],
            }
            for i in writable
        ],
        projects=projects,
        project_questions=wanted_projects,
        skills=[_flat(s, _MAX_TECHNOLOGY_CHARS) for s in (parsed.get("skills") or [])[:20]],
        earlier_rounds=await _earlier_rounds(db, session),
    )
    try:
        answer = await _write_questions(api_key, **request)
    except Exception:
        logger.exception("Could not write the questions for session=%s; keeping the seeded plan", session.id)
        return False

    written = _topic_answers(answer.get("topics"))
    repeats = [
        t for t in request["topics"]
        if (q := _valid_question((written.get(t["id"]) or {}).get("question"))) and is_repeat(q, t["already_asked"])
    ]
    if repeats:
        try:
            retry = await _write_questions(
                api_key, **{**request, "topics": repeats, "projects": [], "project_questions": 0, "earlier_rounds": []}
            )
            written.update(_topic_answers(retry.get("topics")))
        except Exception:
            logger.exception("Retry for repeated questions failed for session=%s", session.id)

    topic_items: list[dict] = []
    for item in seeded_topics:
        entry = written.get(str(item.topic_id)) or {}
        question, points = _valid_question(entry.get("question")), _clean_points(entry.get("expected_points"))
        if question is None or len(points) < _MIN_POINTS:
            question, points = item.question, list(item.expected_points or [])  # keep the seeded one
        topic_items.append({"topic_id": item.topic_id, "topic_name": item.topic_name,
                            "question": question, "expected_points": points, "section": PlanSection.TOPIC})

    project_items: list[dict] = []
    known = {p["name"].lower() for p in projects}
    for entry in answer.get("projects") or []:
        if not isinstance(entry, dict) or len(project_items) >= wanted_projects:
            continue
        name = " ".join(str(entry.get("project") or "").split())
        question, points = _valid_question(entry.get("question")), _clean_points(entry.get("expected_points"))
        if name.lower() not in known or question is None or len(points) < _MIN_POINTS:
            continue
        if any(p["topic_name"].lower() == name.lower() for p in project_items):
            continue
        project_items.append({"topic_id": None, "topic_name": name[:120], "question": question,
                              "expected_points": points, "section": PlanSection.PROJECT})

    intro = next((i for i in items if i.section == PlanSection.INTRO.value), None)
    ordered: list[dict] = []
    if intro is not None:
        ordered.append({"topic_id": None, "topic_name": intro.topic_name, "question": intro.question,
                        "expected_points": list(intro.expected_points or []), "section": PlanSection.INTRO})
    ordered += project_items + topic_items
    points = allocate_points(dict(Counter(i["section"] for i in ordered)))
    cursor = {section: 0 for section in points}

    locked = await _lock(db, session)
    if locked is None or locked.status != "pending" or locked.plan_status != PlanStatus.SEEDED.value:
        return False  # the interview began (or the plan changed) while the questions were being written

    await db.execute(delete(InterviewPlanItem).where(InterviewPlanItem.session_id == locked.id))
    for position, item in enumerate(ordered):
        section = item["section"]
        db.add(InterviewPlanItem(
            session_id=locked.id, position=position, section=section.value, topic_id=item["topic_id"],
            topic_name=item["topic_name"], question=item["question"],
            expected_points=item["expected_points"], points=points[section][cursor[section]],
        ))
        cursor[section] += 1
    locked.plan_status = PlanStatus.GENERATED.value
    locked.plan_generated_at = datetime.now(timezone.utc)
    await db.flush()
    logger.info(
        "Wrote interview plan for session=%s: %d topic and %d project questions",
        locked.id, len(topic_items), len(project_items),
    )
    return True
