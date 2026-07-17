"""
Shortlist Routes — Sprint 4

4.1  POST /api/jobs/{job_id}/shortlist          — trigger AI shortlisting
4.2  GET  /api/jobs/{job_id}/shortlist          — get shortlist results (with candidate name/email)
4.3  PATCH /api/shortlist/{id}/decision         — HR approve / reject / override
4.4  POST  /api/shortlist/{id}/feedback         — HR feedback type + comments
4.5  GET  /api/jobs/{job_id}/shortlist/status   — shortlist run progress
"""

import json
import logging
import uuid
from typing import List, Optional

import redis as redis_lib
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, exists

from app.core.settings import settings
from app.core.database import get_db
from app.core.deps import RequireAdminOrHr, hr_roles
from app.core.logging import get_actor_label, log_event, plural
from app.core.tenancy import get_tenant_job, get_tenant_shortlist_result
from app.models.models import Candidate, Job, ShortlistResult
from app.services.audit_service import log_change, log_field_changes
from app.services.candidate_contact_service import (
    resolve_candidate_email,
    resolve_candidate_name,
)
from app.services.celery_health import CELERY_UNAVAILABLE_MSG, celery_workers_available
from app.schemas.schemas import (
    ShortlistDecisionUpdate,
    ShortlistDecisionResponse,
    ShortlistFeedbackCreate,
    ShortlistResultResponse,
    ShortlistResultWithCandidateResponse,
    ShortlistStatusResponse,
    ShortlistTriggerRequest,
)

router = APIRouter(dependencies=[Depends(hr_roles)])
logger = logging.getLogger(__name__)

SHORTLIST_BATCH_TTL = 600  # 10 minutes


def _redis_client():
    return redis_lib.from_url(settings.REDIS_URL or "redis://localhost:6379/0")


def _shortlist_lock_key(job_id: uuid.UUID) -> str:
    return f"shortlist_lock:{job_id}"


def _shortlist_batch_key(job_id: uuid.UUID) -> str:
    return f"shortlist_batch:{job_id}"


# ---------------------------------------------------------------------------
# Helper — fetch ShortlistResult or 404 (tenant-scoped)
# ---------------------------------------------------------------------------

async def _get_shortlist_or_404(
    shortlist_id: uuid.UUID,
    tenant_id: uuid.UUID,
    db: AsyncSession,
) -> ShortlistResult:
    return await get_tenant_shortlist_result(db, shortlist_id, tenant_id)


async def _candidate_has_shortlist_result(
    candidate_id: uuid.UUID, db: AsyncSession
) -> bool:
    result = await db.execute(
        select(ShortlistResult.id).where(ShortlistResult.candidate_id == candidate_id)
    )
    return result.scalar_one_or_none() is not None



async def _resolve_eligible_candidate_ids(
    job_id: uuid.UUID,
    db: AsyncSession,
    requested_ids: Optional[List[uuid.UUID]],
) -> tuple[List[uuid.UUID], List[dict]]:
    """
    Return eligible candidate UUIDs for shortlisting and a list of skipped entries.
    Eligible: parse_status=ready, belongs to job, no existing ShortlistResult.
    """
    shortlist_exists = (
        select(ShortlistResult.id)
        .where(ShortlistResult.candidate_id == Candidate.id)
        .correlate(Candidate)
    )
    stmt = select(Candidate).where(
        Candidate.job_id == job_id,
        Candidate.parse_status == "ready",
        ~exists(shortlist_exists),
    )
    if requested_ids is not None:
        stmt = stmt.where(Candidate.id.in_(requested_ids))

    result = await db.execute(stmt)
    eligible = [c.id for c in result.scalars().all()]

    skipped: List[dict] = []
    if requested_ids is not None:
        eligible_set = set(eligible)
        for raw_id in requested_ids:
            if raw_id in eligible_set:
                continue
            cand = await db.get(Candidate, raw_id)
            if not cand or cand.job_id != job_id:
                skipped.append({"id": str(raw_id), "reason": "Candidate not found for this job"})
            elif cand.parse_status != "ready":
                skipped.append(
                    {"id": str(raw_id), "reason": f"parse_status is '{cand.parse_status}', expected 'ready'"}
                )
            elif await _candidate_has_shortlist_result(raw_id, db):
                skipped.append({"id": str(raw_id), "reason": "Already shortlisted"})
            else:
                skipped.append({"id": str(raw_id), "reason": "Not eligible for shortlisting"})

    return eligible, skipped


# ---------------------------------------------------------------------------
# Task 4.1 — Trigger shortlisting
# ---------------------------------------------------------------------------

@router.post("/jobs/{job_id}/shortlist", status_code=status.HTTP_202_ACCEPTED)
async def trigger_shortlist(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    body: Optional[ShortlistTriggerRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger AI shortlisting for a job.

    Optional body: { "candidate_ids": ["uuid", ...] }
    If omitted, all eligible ready candidates (without ShortlistResult) are scored.
    """
    job = await get_tenant_job(db, job_id, actor.tenant_id)

    requested_ids = body.candidate_ids if body else None
    eligible_ids, skipped = await _resolve_eligible_candidate_ids(
        job_id, db, requested_ids
    )

    if not eligible_ids:
        detail = "No eligible candidates found for shortlisting."
        if skipped:
            detail = {"message": detail, "skipped": skipped}
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        )

    if not celery_workers_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=CELERY_UNAVAILABLE_MSG,
        )

    _r = _redis_client()
    lock_key = _shortlist_lock_key(job_id)
    try:
        acquired = _r.set(lock_key, "1", nx=True, ex=300)
    except redis_lib.RedisError as exc:
        logger.error("trigger_shortlist: Redis unavailable for job %s: %s", job_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Shortlisting is temporarily unavailable. Try again shortly.",
        ) from exc

    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Shortlisting is already in progress for this job. Please wait.",
        )

    batch_key = _shortlist_batch_key(job_id)
    id_strings = [str(cid) for cid in eligible_ids]
    try:
        _r.set(batch_key, json.dumps(id_strings), ex=SHORTLIST_BATCH_TTL)

        from app.tasks.shortlist_tasks import run_shortlist  # noqa: PLC0415

        run_shortlist.apply_async(args=[str(job_id), id_strings])
    except Exception as exc:
        logger.exception(
            "trigger_shortlist: failed to enqueue shortlist for job %s", job_id
        )
        try:
            _r.delete(lock_key, batch_key)
        except redis_lib.RedisError:
            pass
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Shortlisting is temporarily unavailable. Try again shortly.",
        ) from exc

    await log_change(
        db,
        actor=actor,
        action="shortlist.triggered",
        entity_type="job",
        entity_id=job_id,
        subject_label=job.title,
        feature="shortlist",
        before=None,
        after={"candidate_count": len(id_strings), "candidate_ids": id_strings},
        job_id=job_id,
    )
    await db.commit()

    log_event(
        logger,
        "%s started AI shortlisting for job \"%s\" with %s%s",
        get_actor_label(),
        job.title,
        plural(len(id_strings), "candidate"),
        f" (skipped {plural(len(skipped), 'ineligible candidate')})" if skipped else "",
    )

    response = {
        "status": "shortlisting_started",
        "job_id": str(job_id),
        "candidate_ids": id_strings,
    }
    if skipped:
        response["skipped"] = skipped
    return response


# ---------------------------------------------------------------------------
# Task 4.5 — Shortlist run status
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}/shortlist/status",
    response_model=ShortlistStatusResponse,
)
async def get_shortlist_status(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Return progress for the current or most recent shortlist batch."""
    await get_tenant_job(db, job_id, actor.tenant_id)

    _r = _redis_client()
    try:
        in_progress = bool(_r.exists(_shortlist_lock_key(job_id)))

        batch_raw = _r.get(_shortlist_batch_key(job_id))
        candidate_ids: List[str] = []
        if batch_raw:
            if isinstance(batch_raw, bytes):
                batch_raw = batch_raw.decode("utf-8")
            try:
                parsed = json.loads(batch_raw)
                if isinstance(parsed, list):
                    candidate_ids = [str(cid) for cid in parsed]
            except (json.JSONDecodeError, TypeError, ValueError):
                candidate_ids = []
    except Exception as exc:
        logger.warning("get_shortlist_status: Redis unavailable for job %s: %s", job_id, exc)
        in_progress = False
        candidate_ids = []

    completed = 0
    if candidate_ids:
        cand_uuids = [uuid.UUID(cid) for cid in candidate_ids]
        result = await db.execute(
            select(ShortlistResult.candidate_id).where(
                ShortlistResult.job_id == job_id,
                ShortlistResult.candidate_id.in_(cand_uuids),
            )
        )
        completed = len(result.scalars().all())

    logger.debug(
        "shortlist.progress job_id=%s in_progress=%s completed=%s/%s",
        job_id,
        in_progress,
        completed,
        len(candidate_ids),
    )

    return ShortlistStatusResponse(
        in_progress=in_progress,
        candidate_ids=candidate_ids,
        completed=completed,
        total=len(candidate_ids),
        failed=0,
    )


# ---------------------------------------------------------------------------
# Task 4.2 — Get shortlist results (with candidate name/email)
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}/shortlist",
    response_model=List[ShortlistResultWithCandidateResponse],
)
async def get_shortlist(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    Return all ShortlistResult records for a job, ordered by match_score desc.
    Each record is enriched with candidate name and email.
    """
    await get_tenant_job(db, job_id, actor.tenant_id)

    result = await db.execute(
        select(ShortlistResult)
        .where(ShortlistResult.job_id == job_id)
        .order_by(ShortlistResult.match_score.desc())
    )
    shortlist_records = result.scalars().all()

    if not shortlist_records:
        return []

    candidate_ids = [r.candidate_id for r in shortlist_records]
    candidates_result = await db.execute(
        select(Candidate).where(Candidate.id.in_(candidate_ids))
    )
    candidates_by_id = {c.id: c for c in candidates_result.scalars().all()}

    enriched = []
    for record in shortlist_records:
        candidate = candidates_by_id.get(record.candidate_id)
        parsed = (candidate.parsed_data or {}) if candidate else {}
        candidate_name = parsed.get("name") or (candidate.name if candidate else None)
        raw_email = parsed.get("email") or (candidate.email if candidate else None)
        candidate_email = (
            raw_email
            if raw_email and not str(raw_email).endswith("@upload.pending")
            else None
        )
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
                candidate_name=candidate_name,
                candidate_email=candidate_email,
            )
        )
    logger.debug(
        "shortlist.listed job_id=%s results=%s",
        job_id,
        len(enriched),
    )
    return enriched


# ---------------------------------------------------------------------------
# Task 4.3 — HR decision (approve / reject / override)
# ---------------------------------------------------------------------------

@router.patch("/shortlist/{shortlist_id}/decision", response_model=ShortlistDecisionResponse)
async def update_decision(
    shortlist_id: uuid.UUID,
    payload: ShortlistDecisionUpdate,
    actor: RequireAdminOrHr,
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

    record = await _get_shortlist_or_404(shortlist_id, actor.tenant_id, db)
    previous_decision = record.hr_decision
    record.hr_decision = payload.hr_decision
    candidate = await db.get(Candidate, record.candidate_id)
    subject = resolve_candidate_name(candidate) if candidate else str(record.candidate_id)
    await log_change(
        db,
        actor=actor,
        action="shortlist.decision_set",
        entity_type="shortlist",
        entity_id=record.id,
        subject_label=subject,
        feature="hr_decision",
        before={"hr_decision": previous_decision},
        after={"hr_decision": payload.hr_decision},
        job_id=record.job_id,
    )
    await db.commit()
    await db.refresh(record)

    log_event(
        logger,
        "%s changed the shortlist decision for %s on job review from %s to %s (AI had recommended %s)",
        get_actor_label(),
        subject,
        previous_decision.replace("_", " "),
        payload.hr_decision.replace("_", " "),
        record.recommendation.replace("_", " "),
    )

    if payload.hr_decision == "rejected" and previous_decision != "rejected":
        candidate = await db.get(Candidate, record.candidate_id)
        candidate_email = resolve_candidate_email(candidate)
        if candidate_email:
            job = await db.get(Job, record.job_id)
            job_title = job.title if job else "the position"
            from app.services.email_service import send_rejection_email
            from app.services.email_template_service import get_company_name, get_merged_templates

            templates = await get_merged_templates(db, actor.tenant_id)
            company_name = await get_company_name(db, actor.tenant_id)
            logger.info(
                "Sending rejection email to %s for shortlist=%s",
                candidate_email,
                shortlist_id,
            )
            if not await send_rejection_email(
                resolve_candidate_name(candidate),
                candidate_email,
                job_title,
                templates=templates,
                company_name=company_name,
            ):
                logger.warning(
                    "Rejection decision saved but email failed for shortlist=%s candidate=%s",
                    shortlist_id,
                    record.candidate_id,
                )
        else:
            logger.warning(
                "Rejection decision saved but no valid email for shortlist=%s candidate=%s",
                shortlist_id,
                record.candidate_id,
            )
    elif payload.hr_decision == "rejected" and previous_decision == "rejected":
        logger.debug(
            "Skipping rejection email for shortlist=%s (already rejected)",
            shortlist_id,
        )

    if payload.hr_decision == "approved":
        from app.services.settings_service import load_system_settings

        system_settings = await load_system_settings(db, tenant_id=actor.tenant_id)
        if not system_settings.screening_enabled:
            from app.services.interview_skip_screening_service import (
                advance_approved_candidate_to_interview,
            )

            advance = await advance_approved_candidate_to_interview(
                db,
                candidate_id=record.candidate_id,
                job_id=record.job_id,
            )
            return ShortlistDecisionResponse(
                **ShortlistResultResponse.model_validate(record).model_dump(),
                screening_skipped=True,
                interview_session_id=advance.session_id,
                interview_email_sent=advance.email_sent,
            )

        from app.services.call_window_service import is_within_call_window
        from app.services.celery_health import celery_workers_available
        from app.services.screening_trigger_service import (
            auto_dispatch_unqueued_approved_for_job,
            candidate_has_any_screening_call,
        )

        if celery_workers_available():
            job = await db.get(Job, record.job_id)
            if job and is_within_call_window(job):
                if not await candidate_has_any_screening_call(
                    db, record.job_id, record.candidate_id
                ):
                    await auto_dispatch_unqueued_approved_for_job(db, job)

    return ShortlistDecisionResponse.model_validate(record)


# ---------------------------------------------------------------------------
# Task 4.4 — HR feedback
# ---------------------------------------------------------------------------

@router.post("/shortlist/{shortlist_id}/feedback", response_model=ShortlistResultResponse)
async def submit_feedback(
    shortlist_id: uuid.UUID,
    payload: ShortlistFeedbackCreate,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit HR feedback on a shortlist result.
    Body: { "hr_feedback_type": str, "hr_comments": str | null }
    """
    record = await _get_shortlist_or_404(shortlist_id, actor.tenant_id, db)
    changes = {
        "hr_feedback_type": (record.hr_feedback_type, payload.hr_feedback_type),
        "hr_comments": (record.hr_comments, payload.hr_comments),
    }
    record.hr_feedback_type = payload.hr_feedback_type
    record.hr_comments = payload.hr_comments
    candidate = await db.get(Candidate, record.candidate_id)
    subject = resolve_candidate_name(candidate) if candidate else str(record.candidate_id)
    await log_field_changes(
        db,
        actor=actor,
        action="shortlist.feedback_set",
        entity_type="shortlist",
        entity_id=record.id,
        subject_label=subject,
        changes=changes,
        job_id=record.job_id,
    )
    await db.commit()
    await db.refresh(record)
    return record
