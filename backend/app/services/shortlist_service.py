"""
Shortlist Service — Sprint 4

GPT-4o structured assessment for candidate shortlisting.
Called by both the Celery task (shortlist_tasks.py) and potentially directly
from tests. Uses AsyncSession passed by the caller (NullPool for Celery,
regular pool for FastAPI).
"""

import asyncio
import json
import logging
import uuid

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.prompts.shortlist import (
    PROMPT_VERSION,
    SHORTLIST_SYSTEM_PROMPT,
    build_shortlist_user_prompt,
)
from app.models.models import Candidate, Job, ShortlistResult
from app.core.logging import log_event, plural
from app.schemas.ai_outputs import ShortlistAssessment
from app.services.tenant_integrations_service import load_tenant_integrations

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

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
        "description": (job.description or "")[: config.parsing.shortlist_jd_chars],
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
) -> tuple[float, str, list[str], list[str], str]:
    """
    Call GPT-4o for structured shortlist assessment.

    Returns: (match_score, recommendation, strengths, gaps, reason)
    Raises openai.* exceptions — let the caller handle retries.
    Raises ValidationError if the model returns invalid structured output.
    """
    from app.services.mock_external import mock_openai_enabled, mock_shortlist_assessment

    if mock_openai_enabled():
        return mock_shortlist_assessment()

    model_cfg = config.models.shortlist
    response = await client.chat.completions.create(
        model=model_cfg.name,
        response_format=model_cfg.openai_response_format(),
        temperature=model_cfg.temperature,
        max_tokens=model_cfg.max_tokens,
        messages=[
            {
                "role": "system",
                "content": SHORTLIST_SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": build_shortlist_user_prompt(
                    jd_summary,
                    candidate_summary,
                ),
            },
        ],
    )

    raw = response.choices[0].message.content or "{}"
    assessment = ShortlistAssessment.model_validate(json.loads(raw))

    return (
        float(assessment.match_score),
        assessment.recommendation,
        list(assessment.strengths),
        list(assessment.gaps),
        assessment.reason,
    )


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
    model_name = config.models.shortlist.name

    if existing:
        existing.match_score = match_score
        existing.recommendation = recommendation
        existing.strengths = strengths
        existing.gaps = gaps
        existing.reason = reason
        existing.model_name = model_name
        existing.prompt_version = PROMPT_VERSION
        # Preserve hr_decision, hr_feedback_type, hr_comments on re-score
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
            model_name=model_name,
            prompt_version=PROMPT_VERSION,
        )
        db.add(record)
        logger.debug("Created new ShortlistResult for candidate %s", candidate.id)

    return record


async def _score_and_persist_candidate(
    candidate: Candidate,
    job_id: uuid.UUID,
    jd_summary: dict,
    client,
    semaphore: asyncio.Semaphore,
    db: AsyncSession,
    db_lock: asyncio.Lock,
) -> ShortlistResult | None:
    """Score one candidate (GPT under semaphore) and upsert ShortlistResult.

    Returns None when assessment fails unexpectedly (fail closed — no fake score).
    Rate limit / connection errors are re-raised for Celery retry.
    """
    import openai  # local import — avoids circular at task discovery time

    candidate_summary = _build_candidate_summary(candidate)

    async with semaphore:
        try:
            match_score, recommendation, strengths, gaps, reason = await _gpt4o_assess(
                client, jd_summary, candidate_summary
            )
        except (openai.RateLimitError, openai.APIConnectionError):
            raise
        except (ValidationError, json.JSONDecodeError) as exc:
            logger.error(
                "Shortlist assessment invalid for candidate %s (job %s): %s",
                candidate.id,
                job_id,
                exc,
            )
            return None
        except Exception as exc:
            logger.error(
                "GPT-4o assessment failed for candidate %s (job %s): %s",
                candidate.id,
                job_id,
                exc,
            )
            return None

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

    fit = (
        "a strong fit"
        if match_score >= 80
        else "a partial fit"
        if match_score >= 50
        else "a weak fit"
    )
    logger.debug(
        "AI scored candidate %s as %s and recommended %s",
        candidate.name or "an unnamed candidate",
        fit,
        recommendation,
    )
    return record


# ---------------------------------------------------------------------------
# Main service entry point (Task 4.5)
# ---------------------------------------------------------------------------

async def shortlist_candidates(
    job_id: uuid.UUID,
    db: AsyncSession,
    candidate_ids: list[uuid.UUID] | None = None,
    *,
    force: bool = False,
) -> tuple[list[ShortlistResult], int]:
    """
    Run AI shortlisting for all ready candidates in a job.

    Steps:
    1. Load job + all candidates with parse_status = 'ready'
    2. Score candidates in parallel (up to MAX_CONCURRENT_SHORTLISTS GPT calls)
    3. Upsert ShortlistResult records as each candidate completes
    4. Return (upserted records, failed_count)

    When force=True, re-score candidates that already have ShortlistResult rows,
    updating AI fields while preserving HR decision/feedback.

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

    integrations = await load_tenant_integrations(db, job.tenant_id)
    integrations.require("openai_api_key")
    api_key = integrations.openai_api_key

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
        logger.debug("shortlist_candidates: no ready candidates for job %s — checking all statuses", job_id)
        # Debug: log all candidate statuses for this job
        all_result = await db.execute(select(Candidate).where(Candidate.job_id == job_id))
        all_candidates = all_result.scalars().all()
        for c in all_candidates:
            logger.debug("  candidate %s has parse_status=%r", c.id, c.parse_status)
        return [], 0

    candidate_id_set = [c.id for c in candidates]
    existing_shortlist = await db.execute(
        select(ShortlistResult).where(
            ShortlistResult.job_id == job_id,
            ShortlistResult.candidate_id.in_(candidate_id_set),
        )
    )
    already_scored = {r.candidate_id: r for r in existing_shortlist.scalars().all()}

    if force:
        candidates_to_score = list(candidates)
        upserted_from_prior: list[ShortlistResult] = []
    else:
        candidates_to_score = [c for c in candidates if c.id not in already_scored]
        upserted_from_prior = list(already_scored.values())

    if not candidates_to_score:
        log_event(
            logger,
            "All ready candidates for job \"%s\" were already scored — nothing new to shortlist",
            job.title,
        )
        return upserted_from_prior, 0

    log_event(
        logger,
        "Scoring %s for job \"%s\"%s%s",
        plural(len(candidates_to_score), "candidate"),
        job.title,
        f" ({plural(len(already_scored), 'candidate')} already scored)" if already_scored and not force else "",
        " (force re-score)" if force else "",
    )

    jd_summary = _build_jd_summary(job)
    client = AsyncOpenAI(api_key=api_key)

    semaphore = asyncio.Semaphore(config.concurrency.max_shortlists)
    db_lock = asyncio.Lock()

    scored_or_none = await asyncio.gather(
        *[
            _score_and_persist_candidate(
                candidate,
                job_id,
                jd_summary,
                client,
                semaphore,
                db,
                db_lock,
            )
            for candidate in candidates_to_score
        ]
    )

    newly_scored = [r for r in scored_or_none if r is not None]
    failed_count = sum(1 for r in scored_or_none if r is None)

    upserted_records: list[ShortlistResult] = list(upserted_from_prior)
    upserted_records.extend(newly_scored)

    log_event(
        logger,
        "Finished scoring candidates for job \"%s\"%s",
        job.title,
        f" ({plural(failed_count, 'failure')})" if failed_count else "",
    )
    return upserted_records, failed_count
