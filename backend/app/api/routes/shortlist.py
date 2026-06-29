"""
Shortlist Routes — Sprint 4

4.1  POST /api/jobs/{job_id}/shortlist     — trigger AI shortlisting
4.2  GET  /api/jobs/{job_id}/shortlist     — get shortlist results (with candidate name/email)
4.3  PATCH /api/shortlist/{id}/decision   — HR approve / reject / override
4.4  POST  /api/shortlist/{id}/feedback   — HR feedback type + comments
"""

import uuid
from typing import List

import redis as redis_lib
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.models.models import Candidate, Job, ShortlistResult
from app.schemas.schemas import (
    ShortlistDecisionUpdate,
    ShortlistFeedbackCreate,
    ShortlistResultResponse,
    ShortlistResultWithCandidateResponse,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helper — fetch ShortlistResult or 404
# ---------------------------------------------------------------------------

async def _get_shortlist_or_404(
    shortlist_id: uuid.UUID, db: AsyncSession
) -> ShortlistResult:
    result = await db.execute(
        select(ShortlistResult).where(ShortlistResult.id == shortlist_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shortlist result not found",
        )
    return record


# ---------------------------------------------------------------------------
# Task 4.1 — Trigger shortlisting
# ---------------------------------------------------------------------------

@router.post("/jobs/{job_id}/shortlist", status_code=status.HTTP_202_ACCEPTED)
async def trigger_shortlist(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger AI shortlisting for a job.

    - Validates job exists (404 if not)
    - Validates at least one candidate with parse_status='ready' exists (422 if none)
    - Enqueues tasks.run_shortlist Celery task
    - Returns immediately with 202 Accepted
    """
    # --- Validate job exists ---
    job_result = await db.execute(select(Job).where(Job.id == job_id))
    job = job_result.scalar_one_or_none()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )

    # --- Validate at least one ready candidate ---
    ready_result = await db.execute(
        select(Candidate).where(
            Candidate.job_id == job_id,
            Candidate.parse_status == "ready",
        )
    )
    ready_candidates = ready_result.scalars().all()
    if not ready_candidates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "No candidates with parse_status='ready' found for this job. "
                "Wait for resume parsing to complete before triggering shortlisting."
            ),
        )

    # --- B-7: Redis concurrent-execution lock ---
    # Prevents double-triggering when HR clicks the button twice or a retry races
    # with an in-progress run. Lock expires after 5 min in case Celery task crashes.
    _r = redis_lib.from_url(settings.REDIS_URL or "redis://localhost:6379/0")
    lock_key = f"shortlist_lock:{job_id}"
    acquired = _r.set(lock_key, "1", nx=True, ex=300)
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shortlisting is already in progress for this job. Please wait.",
        )

    # --- Enqueue Celery task ---
    from app.tasks.shortlist_tasks import run_shortlist  # noqa: PLC0415

    run_shortlist.apply_async(args=[str(job_id)])

    return {
        "status": "shortlisting_started",
        "job_id": str(job_id),
    }


# ---------------------------------------------------------------------------
# Task 4.2 — Get shortlist results (with candidate name/email)
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}/shortlist",
    response_model=List[ShortlistResultWithCandidateResponse],
)
async def get_shortlist(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Return all ShortlistResult records for a job, ordered by match_score desc.
    Each record is enriched with candidate name and email.
    """
    # Validate job exists
    job_result = await db.execute(select(Job).where(Job.id == job_id))
    if not job_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found",
        )

    result = await db.execute(
        select(ShortlistResult)
        .where(ShortlistResult.job_id == job_id)
        .order_by(ShortlistResult.match_score.desc())
    )
    shortlist_records = result.scalars().all()

    if not shortlist_records:
        return []

    # Batch-load candidates to avoid N+1
    candidate_ids = [r.candidate_id for r in shortlist_records]
    candidates_result = await db.execute(
        select(Candidate).where(Candidate.id.in_(candidate_ids))
    )
    candidates_by_id = {c.id: c for c in candidates_result.scalars().all()}

    enriched = []
    for record in shortlist_records:
        candidate = candidates_by_id.get(record.candidate_id)
        enriched.append(
            ShortlistResultWithCandidateResponse(
                id=record.id,
                candidate_id=record.candidate_id,
                job_id=record.job_id,
                match_score=record.match_score,
                recommendation=record.recommendation,
                strengths=record.strengths,
                gaps=record.gaps,
                reason=record.reason,
                hr_decision=record.hr_decision,
                hr_feedback_type=record.hr_feedback_type,
                hr_comments=record.hr_comments,
                created_at=record.created_at,
                candidate_name=candidate.name if candidate else None,
                candidate_email=(
                    candidate.email
                    if candidate and not candidate.email.endswith("@upload.pending")
                    else None
                ),
            )
        )
    return enriched


# ---------------------------------------------------------------------------
# Task 4.3 — HR decision (approve / reject / override)
# ---------------------------------------------------------------------------

@router.patch("/shortlist/{shortlist_id}/decision", response_model=ShortlistResultResponse)
async def update_decision(
    shortlist_id: uuid.UUID,
    payload: ShortlistDecisionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Set HR decision on a shortlist result.
    Body: { "hr_decision": "approved" | "rejected" | "overridden" }
    """
    valid_decisions = {"approved", "rejected", "overridden"}
    if payload.hr_decision not in valid_decisions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"hr_decision must be one of: {', '.join(sorted(valid_decisions))}",
        )

    record = await _get_shortlist_or_404(shortlist_id, db)
    record.hr_decision = payload.hr_decision
    await db.commit()
    await db.refresh(record)
    return record


# ---------------------------------------------------------------------------
# Task 4.4 — HR feedback
# ---------------------------------------------------------------------------

@router.post("/shortlist/{shortlist_id}/feedback", response_model=ShortlistResultResponse)
async def submit_feedback(
    shortlist_id: uuid.UUID,
    payload: ShortlistFeedbackCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit HR feedback on a shortlist result.
    Body: { "hr_feedback_type": str, "hr_comments": str | null }
    """
    record = await _get_shortlist_or_404(shortlist_id, db)
    record.hr_feedback_type = payload.hr_feedback_type
    record.hr_comments = payload.hr_comments
    await db.commit()
    await db.refresh(record)
    return record
