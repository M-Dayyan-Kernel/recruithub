"""
Shortlist Service — Sprint 4

Cosine similarity + GPT-4o structured assessment for candidate shortlisting.
Called by both the Celery task (shortlist_tasks.py) and potentially directly
from tests. Uses AsyncSession passed by the caller (NullPool for Celery,
regular pool for FastAPI).
"""

import asyncio
import json
import logging
import math
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Candidate, Job, ShortlistResult
from app.services.embedding_service import generate_embedding

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Pure-Python cosine similarity. Returns 0.0 on zero-magnitude vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x ** 2 for x in a))
    mag_b = math.sqrt(sum(x ** 2 for x in b))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)


def _build_jd_text(job: Job) -> str:
    """Build a single text string representing the Job Description for embedding."""
    parts = [job.title, job.description]
    if job.required_skills:
        parts.append("Required skills: " + ", ".join(job.required_skills))
    if job.screening_questions:
        q_lines = [
            (q.get("question") or "").strip()
            for q in job.screening_questions
            if isinstance(q, dict) and (q.get("question") or "").strip()
        ]
        if q_lines:
            parts.append("Screening questions: " + "; ".join(q_lines))
    if job.interview_questions:
        q_lines = [
            (q.get("question") or "").strip()
            for q in job.interview_questions
            if isinstance(q, dict) and (q.get("question") or "").strip()
        ]
        if q_lines:
            parts.append("Interview questions: " + "; ".join(q_lines))
    return "\n\n".join(p for p in parts if p)


def _build_candidate_summary(candidate: Candidate) -> dict:
    """Extract the subset of parsed_data relevant for GPT-4o assessment."""
    parsed = candidate.parsed_data or {}
    return {
        "name": candidate.name,
        "skills": parsed.get("skills", []),
        "total_experience_years": parsed.get("total_experience_years", 0),
        "experience": parsed.get("experience", []),
        "education": parsed.get("education", []),
        "current_company": parsed.get("current_company"),
        "current_role": parsed.get("current_role"),
    }


def _build_jd_summary(job: Job) -> dict:
    """Extract the subset of job fields relevant for GPT-4o assessment."""
    return {
        "title": job.title,
        # Truncate to 1200 chars — enough context, avoids ballooning prompt
        "description": (job.description or "")[:1200],
        "required_skills": job.required_skills or [],
        "experience_min": job.experience_min,
        "experience_max": job.experience_max,
        "screening_questions": job.screening_questions or [],
    }


# ---------------------------------------------------------------------------
# GPT-4o assessment (Task 4.6)
# ---------------------------------------------------------------------------

async def _gpt4o_assess(
    client,
    jd_summary: dict,
    candidate_summary: dict,
    similarity: float,
) -> tuple[float, str, list[str], list[str], str]:
    """
    Call GPT-4o for structured shortlist assessment.

    Returns: (match_score, recommendation, strengths, gaps, reason)
    Raises openai.* exceptions — let the caller handle retries.
    """
    response = await client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        temperature=0,
        max_tokens=1000,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an expert recruiter assessing candidate-JD fit. "
                    "Analyse the candidate profile against the job description and return "
                    "a structured JSON assessment with these exact keys:\n"
                    "  match_score: integer 0-100 (overall fit percentage)\n"
                    "  recommendation: one of 'shortlisted' | 'rejected' | 'review'\n"
                    "  strengths: array of 2-5 short strings (candidate's matching strengths)\n"
                    "  gaps: array of 0-5 short strings (missing skills or experience gaps)\n"
                    "  reason: string, 1-2 sentences explaining the recommendation\n\n"
                    "Scoring guide:\n"
                    "  80-100 → shortlisted (strong match)\n"
                    "  50-79  → review (partial match, HR should decide)\n"
                    "  0-49   → rejected (poor fit)\n\n"
                    "Use the cosine similarity hint as supporting signal, "
                    "but base your final score primarily on skill and experience fit."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Job Description:\n{json.dumps(jd_summary, indent=2)}\n\n"
                    f"Candidate Profile:\n{json.dumps(candidate_summary, indent=2)}\n\n"
                    f"Cosine similarity (resume vs JD, 0-1 scale): {similarity:.4f}\n\n"
                    "Return the JSON assessment."
                ),
            },
        ],
    )

    raw = response.choices[0].message.content or "{}"
    assessment = json.loads(raw)

    match_score = float(assessment.get("match_score", round(similarity * 100, 1)))
    # Clamp to [0, 100]
    match_score = max(0.0, min(100.0, match_score))

    recommendation = assessment.get("recommendation", "review")
    if recommendation not in ("shortlisted", "rejected", "review"):
        recommendation = "review"

    strengths = assessment.get("strengths") or []
    gaps = assessment.get("gaps") or []
    reason = assessment.get("reason") or ""

    return match_score, recommendation, strengths, gaps, reason


def _cosine_similarity_for_candidate(
    candidate: Candidate,
    jd_embedding: list[float],
) -> float:
    """Cosine similarity between JD and candidate resume embedding (0.0 if unavailable)."""
    if not jd_embedding or candidate.resume_embedding is None:
        logger.info(
            "shortlist_candidates: no embedding for candidate %s (resume_embedding=%r) — skipping cosine, using GPT-4o only",
            candidate.id,
            type(candidate.resume_embedding).__name__,
        )
        return 0.0
    try:
        return _cosine_similarity(jd_embedding, list(candidate.resume_embedding))
    except Exception as exc:
        logger.warning("Cosine similarity failed for candidate %s: %s", candidate.id, exc)
        return 0.0


async def _upsert_shortlist_result(
    db: AsyncSession,
    job_id: uuid.UUID,
    candidate: Candidate,
    match_score: float,
    recommendation: str,
    strengths: list[str],
    gaps: list[str],
    reason: str,
) -> ShortlistResult:
    existing_result = await db.execute(
        select(ShortlistResult).where(
            ShortlistResult.job_id == job_id,
            ShortlistResult.candidate_id == candidate.id,
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing:
        existing.match_score = match_score
        existing.recommendation = recommendation
        existing.strengths = strengths
        existing.gaps = gaps
        existing.reason = reason
        record = existing
        logger.debug("Updated existing ShortlistResult for candidate %s", candidate.id)
    else:
        record = ShortlistResult(
            job_id=job_id,
            candidate_id=candidate.id,
            match_score=match_score,
            recommendation=recommendation,
            strengths=strengths,
            gaps=gaps,
            reason=reason,
            hr_decision="pending",
        )
        db.add(record)
        logger.debug("Created new ShortlistResult for candidate %s", candidate.id)

    return record


async def _score_and_persist_candidate(
    candidate: Candidate,
    job_id: uuid.UUID,
    jd_embedding: list[float],
    jd_summary: dict,
    client,
    semaphore: asyncio.Semaphore,
    db: AsyncSession,
    db_lock: asyncio.Lock,
) -> ShortlistResult:
    """Score one candidate (GPT under semaphore) and upsert ShortlistResult."""
    import openai  # local import — avoids circular at task discovery time

    similarity = _cosine_similarity_for_candidate(candidate, jd_embedding)
    candidate_summary = _build_candidate_summary(candidate)

    async with semaphore:
        try:
            match_score, recommendation, strengths, gaps, reason = await _gpt4o_assess(
                client, jd_summary, candidate_summary, similarity
            )
        except (openai.RateLimitError, openai.APIConnectionError):
            raise
        except Exception as exc:
            logger.error(
                "GPT-4o assessment failed for candidate %s (job %s): %s",
                candidate.id,
                job_id,
                exc,
            )
            match_score = round(similarity * 100, 1)
            recommendation = (
                "shortlisted" if match_score >= 80
                else "review" if match_score >= 50
                else "rejected"
            )
            strengths = []
            gaps = []
            reason = "AI assessment unavailable — cosine similarity score used as fallback."

    async with db_lock:
        record = await _upsert_shortlist_result(
            db,
            job_id,
            candidate,
            match_score,
            recommendation,
            strengths,
            gaps,
            reason,
        )
        await db.commit()
        await db.refresh(record)

    return record


# ---------------------------------------------------------------------------
# Main service entry point (Task 4.5)
# ---------------------------------------------------------------------------

async def shortlist_candidates(
    job_id: uuid.UUID,
    db: AsyncSession,
    candidate_ids: list[uuid.UUID] | None = None,
) -> list[ShortlistResult]:
    """
    Run AI shortlisting for all ready candidates in a job.

    Steps:
    1. Load job + all candidates with parse_status = 'ready'
    2. Build JD text → generate JD embedding
    3. Score candidates in parallel (up to MAX_CONCURRENT_SHORTLISTS GPT calls)
    4. Upsert ShortlistResult records as each candidate completes
    5. Return list of upserted records

    Raises:
        ValueError: if job not found
        openai.*: if OpenAI API fails (let caller handle retries)
    """
    from openai import AsyncOpenAI  # local import — avoids circular at task discovery time

    # --- Load job ---
    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalar_one_or_none()
    if not job:
        raise ValueError(f"Job {job_id} not found")

    # --- Load ready candidates (optionally filtered to a subset) ---
    stmt = select(Candidate).where(
        Candidate.job_id == job_id,
        Candidate.parse_status == "ready",
    )
    if candidate_ids:
        stmt = stmt.where(Candidate.id.in_(candidate_ids))
    candidates_result = await db.execute(stmt)
    candidates = candidates_result.scalars().all()

    if not candidates:
        logger.info("shortlist_candidates: no ready candidates for job %s — checking all statuses for debug", job_id)
        # Debug: log all candidate statuses for this job
        all_result = await db.execute(select(Candidate).where(Candidate.job_id == job_id))
        all_candidates = all_result.scalars().all()
        for c in all_candidates:
            logger.info("  candidate %s has parse_status=%r", c.id, c.parse_status)
        return []

    candidate_id_set = [c.id for c in candidates]
    existing_shortlist = await db.execute(
        select(ShortlistResult).where(
            ShortlistResult.job_id == job_id,
            ShortlistResult.candidate_id.in_(candidate_id_set),
        )
    )
    already_scored = {r.candidate_id: r for r in existing_shortlist.scalars().all()}
    candidates_to_score = [c for c in candidates if c.id not in already_scored]
    upserted_from_prior = list(already_scored.values())

    if not candidates_to_score:
        logger.info(
            "shortlist_candidates: all %d candidates already scored for job %s",
            len(candidates),
            job_id,
        )
        return upserted_from_prior

    logger.info(
        "shortlist_candidates: scoring %d ready candidates for job %s (max_concurrent=%d, %d already scored)",
        len(candidates_to_score),
        job_id,
        settings.MAX_CONCURRENT_SHORTLISTS,
        len(already_scored),
    )

    # --- Build JD embedding (best-effort — used for cosine similarity hint) ---
    jd_embedding: list[float] = []
    try:
        jd_text = _build_jd_text(job)
        jd_embedding = await generate_embedding(jd_text)
    except Exception as exc:
        logger.warning("shortlist_candidates: failed to build JD embedding — will skip cosine similarity: %s", exc)

    jd_summary = _build_jd_summary(job)
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_SHORTLISTS)
    db_lock = asyncio.Lock()

    upserted_records: list[ShortlistResult] = list(upserted_from_prior)
    newly_scored = await asyncio.gather(
        *[
            _score_and_persist_candidate(
                candidate,
                job_id,
                jd_embedding,
                jd_summary,
                client,
                semaphore,
                db,
                db_lock,
            )
            for candidate in candidates_to_score
        ]
    )
    upserted_records.extend(newly_scored)

    logger.info(
        "shortlist_candidates: completed %d shortlist records for job %s",
        len(upserted_records),
        job_id,
    )
    return upserted_records
