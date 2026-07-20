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
