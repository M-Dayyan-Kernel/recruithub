"""
Combined resume processing + shortlisting in a single AI call.

Triggered automatically on upload. Persists profile on Candidate and
ShortlistResult assessment for the HR shortlist tab.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.logging import log_event, plural
from app.models.models import Candidate, Job, ShortlistResult
from app.prompts.combined_shortlist import (
    COMBINED_SHORTLIST_SYSTEM_PROMPT,
    PROMPT_VERSION,
    build_combined_shortlist_user_prompt,
)
from app.schemas.ai_outputs import CombinedShortlistOutput
from app.services.document_extractor import (
    UnsupportedDocumentError,
    extract_text_from_bytes,
)
from app.services.tenant_integrations_service import load_tenant_integrations
from app.services.text_utils import head_tail_truncate

logger = logging.getLogger(__name__)


def build_jd_summary(job: Job) -> dict:
    """JD fields sent to the combined shortlist model."""
    return {
        "title": job.title,
        "description": (job.description or "")[: config.parsing.shortlist_jd_chars],
        "required_skills": job.required_skills or [],
        "experience_min": job.experience_min,
        "experience_max": job.experience_max,
        "screening_questions": job.screening_questions or [],
    }


def _attach_profile_meta(profile: dict, model_name: str) -> dict:
    result = dict(profile)
    result["_meta"] = {
        "model": model_name,
        "prompt_version": PROMPT_VERSION,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }
    return result


def _combined_shortlist_sync(
    resume_text: str,
    jd_summary: dict,
    api_key: str,
) -> CombinedShortlistOutput:
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    model_cfg = config.models.combined_shortlist
    truncated = head_tail_truncate(resume_text, config.parsing.resume_max_chars)
    response = client.chat.completions.create(
        model=model_cfg.name,
        response_format=model_cfg.openai_response_format(),
        messages=[
            {"role": "system", "content": COMBINED_SHORTLIST_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": build_combined_shortlist_user_prompt(truncated, jd_summary),
            },
        ],
        temperature=model_cfg.temperature,
        max_tokens=model_cfg.max_tokens,
    )
    raw = json.loads(response.choices[0].message.content or "{}")
    return CombinedShortlistOutput.model_validate(raw)


async def call_combined_shortlist(
    resume_text: str,
    jd_summary: dict,
    api_key: str,
) -> CombinedShortlistOutput:
    from app.services.mock_external import mock_combined_shortlist, mock_openai_enabled

    if mock_openai_enabled():
        return mock_combined_shortlist()

    return await asyncio.to_thread(
        _combined_shortlist_sync, resume_text, jd_summary, api_key
    )


def _apply_profile_to_candidate(candidate: Candidate, profile: dict) -> None:
    candidate.parsed_data = profile
    if profile.get("name"):
        candidate.name = profile["name"]
    if profile.get("email") and candidate.email.endswith("@upload.pending"):
        candidate.email = profile["email"]
    if profile.get("phone") and not candidate.phone:
        candidate.phone = profile["phone"]


async def _upsert_shortlist_from_assessment(
    db: AsyncSession,
    job_id: uuid.UUID,
    candidate: Candidate,
    assessment: CombinedShortlistOutput,
) -> ShortlistResult:
    model_name = config.models.combined_shortlist.name
    a = assessment.assessment

    existing_result = await db.execute(
        select(ShortlistResult).where(
            ShortlistResult.job_id == job_id,
            ShortlistResult.candidate_id == candidate.id,
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing:
        existing.match_score = float(a.match_score)
        existing.recommendation = a.recommendation
        existing.strengths = list(a.strengths)
        existing.gaps = list(a.gaps)
        existing.reason = a.reason
        existing.model_name = model_name
        existing.prompt_version = PROMPT_VERSION
        record = existing
    else:
        record = ShortlistResult(
            job_id=job_id,
            candidate_id=candidate.id,
            match_score=float(a.match_score),
            recommendation=a.recommendation,
            strengths=list(a.strengths),
            gaps=list(a.gaps),
            reason=a.reason,
            hr_decision="pending",
            model_name=model_name,
            prompt_version=PROMPT_VERSION,
        )
        db.add(record)

    return record


async def process_candidate_resume_shortlist(
    db: AsyncSession,
    candidate: Candidate,
    job: Job,
    api_key: str,
) -> ShortlistResult:
    """Extract resume text, run combined AI, persist profile + ShortlistResult."""
    from app.services.s3_service import download_bytes, is_s3_object_key

    stored = candidate.resume_file_path or ""
    if is_s3_object_key(stored):
        file_bytes = download_bytes(stored)
        suffix = Path(stored).suffix.lower() or Path(
            candidate.original_filename or ""
        ).suffix.lower()
    else:
        file_path = Path(stored)
        if not file_path.exists():
            raise FileNotFoundError(stored)
        file_bytes = file_path.read_bytes()
        suffix = file_path.suffix.lower()

    filename = candidate.original_filename or f"resume{suffix}"
    text = extract_text_from_bytes(file_bytes, filename)

    if not text or len(text.strip()) < config.parsing.min_resume_chars:
        raise ValueError("Resume text too short or empty")

    combined = await call_combined_shortlist(text, build_jd_summary(job), api_key)
    profile = _attach_profile_meta(
        combined.profile.model_dump(),
        config.models.combined_shortlist.name,
    )
    _apply_profile_to_candidate(candidate, profile)
    return await _upsert_shortlist_from_assessment(
        db,
        job.id,
        candidate,
        combined,
    )


async def _rescore_and_persist_candidate(
    candidate: Candidate,
    job: Job,
    api_key: str,
    semaphore: asyncio.Semaphore,
    db: AsyncSession,
    db_lock: asyncio.Lock,
) -> ShortlistResult | None:
    """Re-extract resume, run combined AI, upsert ShortlistResult.

    Returns None on per-candidate failure (fail closed). Re-raises OpenAI
    rate-limit / connection errors for Celery retry.
    """
    import openai

    async with semaphore:
        try:
            async with db_lock:
                record = await process_candidate_resume_shortlist(
                    db, candidate, job, api_key
                )
                await db.commit()
                await db.refresh(record)
                return record
        except (openai.RateLimitError, openai.APIConnectionError):
            raise
        except (ValidationError, json.JSONDecodeError) as exc:
            logger.error(
                "Combined shortlist invalid for candidate %s (job %s): %s",
                candidate.id,
                job.id,
                exc,
            )
            return None
        except (UnsupportedDocumentError, FileNotFoundError, ValueError) as exc:
            logger.error(
                "Cannot re-score candidate %s (job %s): %s",
                candidate.id,
                job.id,
                exc,
            )
            return None
        except Exception as exc:
            logger.error(
                "Combined shortlist failed for candidate %s (job %s): %s",
                candidate.id,
                job.id,
                exc,
            )
            return None


async def batch_rescore_candidates(
    job_id: uuid.UUID,
    db: AsyncSession,
    candidate_ids: list[uuid.UUID] | None = None,
    *,
    force: bool = False,
) -> tuple[list[ShortlistResult], int]:
    """Batch re-run combined extract+shortlist for completed candidates.

    Same eligibility rules as the legacy shortlist endpoint: pipeline_status
    must be ``completed``. When force=False, skips candidates that already
    have a ShortlistResult. Re-extracts the resume file and preserves HR
    decision fields on existing rows.
    """
    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalar_one_or_none()
    if not job:
        raise ValueError(f"Job {job_id} not found")

    integrations = await load_tenant_integrations(db, job.tenant_id)
    integrations.require("openai_api_key")
    api_key = integrations.openai_api_key

    stmt = select(Candidate).where(
        Candidate.job_id == job_id,
        Candidate.pipeline_status == "completed",
    )
    if candidate_ids:
        stmt = stmt.where(Candidate.id.in_(candidate_ids))
    candidates_result = await db.execute(stmt)
    candidates = candidates_result.scalars().all()

    if not candidates:
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
        "Re-scoring %s for job \"%s\"%s%s",
        plural(len(candidates_to_score), "candidate"),
        job.title,
        f" ({plural(len(already_scored), 'candidate')} already scored)" if already_scored and not force else "",
        " (force re-score)" if force else "",
    )

    semaphore = asyncio.Semaphore(config.concurrency.max_shortlists)
    db_lock = asyncio.Lock()

    scored_or_none = await asyncio.gather(
        *[
            _rescore_and_persist_candidate(
                candidate, job, api_key, semaphore, db, db_lock
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
        "Finished re-scoring candidates for job \"%s\"%s",
        job.title,
        f" ({plural(failed_count, 'failure')})" if failed_count else "",
    )
    return upserted_records, failed_count
