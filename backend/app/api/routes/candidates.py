import uuid
import logging
from pathlib import Path
from typing import Optional, List, Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, exists

from app.core.config_loader import config
from app.core.database import get_db
from app.core.deps import RequireAdminOrHr, hr_roles
from app.core.logging import get_actor_label, log_event, plural
from app.core.tenancy import get_tenant_candidate, get_tenant_job
from app.models.models import Candidate, ShortlistResult
from app.schemas.schemas import CandidateResponse, CandidateUpdate, ResumeUploadResponse
from app.services.audit_service import log_change, log_field_changes

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(hr_roles)])

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_EXTENSIONS = {".pdf", ".docx"}
ZIP_CONTENT_TYPES = {"application/zip", "application/x-zip-compressed"}
ZIP_EXTENSIONS = {".zip"}


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _is_allowed_file(file: UploadFile) -> bool:
    """Return True if the file passes content-type AND extension checks."""
    ct_ok = file.content_type in ALLOWED_CONTENT_TYPES
    ext_ok = Path(file.filename or "").suffix.lower() in ALLOWED_EXTENSIONS
    return ct_ok or ext_ok  # trust whichever passes (browser CT can be unreliable)


def _is_zip_file(file: UploadFile) -> bool:
    ct_ok = file.content_type in ZIP_CONTENT_TYPES
    ext_ok = Path(file.filename or "").suffix.lower() in ZIP_EXTENSIONS
    return ct_ok or ext_ok


def _is_allowed_upload(file: UploadFile) -> bool:
    return _is_allowed_file(file) or _is_zip_file(file)


async def _ingest_resume_file(
    job_id: uuid.UUID,
    tenant_id: uuid.UUID,
    filename: str,
    content: bytes,
    upload_dir: Path,
    db: AsyncSession,
) -> tuple[Literal["created", "skipped", "oversized"], str | None]:
    """Save a resume and create a Candidate row, or report skip reason."""
    if len(content) > MAX_FILE_SIZE:
        return "oversized", filename

    filename = Path(filename).name

    existing_result = await db.execute(
        select(Candidate).where(
            Candidate.job_id == job_id,
            Candidate.original_filename == filename,
        )
    )
    if existing_result.scalars().first():
        logger.debug(
            "Skipping a duplicate resume upload named %s",
            filename,
        )
        return "skipped", filename

    from app.services.s3_service import (  # noqa: PLC0415
        resume_object_key,
        s3_configured,
        upload_bytes,
    )

    if s3_configured():
        suffix = Path(filename).suffix.lower()
        content_type = (
            "application/pdf"
            if suffix == ".pdf"
            else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        stored_path = upload_bytes(
            resume_object_key(tenant_id, job_id, filename),
            content,
            content_type=content_type,
        )
    else:
        dest = upload_dir / filename
        dest.write_bytes(content)
        stored_path = str(dest)

    candidate = Candidate(
        job_id=job_id,
        name=Path(filename).stem,
        email=f"pending_{uuid.uuid4().hex}@upload.pending",
        resume_file_path=stored_path,
        original_filename=filename,
        parse_status="pending_parse",
    )
    db.add(candidate)
    await db.flush()
    return "created", str(candidate.id)


# ---------------------------------------------------------------------------
# Task 3.2 — Resume Upload  (updated: B-4 dedup, B-5 size limit)
# ---------------------------------------------------------------------------

MAX_FILE_SIZE = config.uploads.resume_max_bytes


@router.post(
    "/jobs/{job_id}/resumes",
    response_model=ResumeUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_resumes(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload resume files (PDF / DOCX) or ZIP archives containing them.

    Deduplicates by original filename per job — skipped files are reported in the
    response without raising an error. Returns created/skipped counts.
    Individual files exceeding 20 MB raise 413; ZIP archives may be up to 100 MB.
    Oversized members inside a ZIP are skipped individually.
    """

    # --- Validate file types BEFORE any DB/disk work ---
    for f in files:
        if not _is_allowed_upload(f):
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "error": "unsupported_file_type",
                    "message": "Only PDF, DOCX, and ZIP files are accepted.",
                },
            )

    # --- Verify job exists for this tenant ---
    job = await get_tenant_job(db, job_id, actor.tenant_id)

    # --- Prepare upload directory ---
    upload_dir = Path(config.UPLOAD_DIR) / str(actor.tenant_id) / str(job_id)
    try:
        upload_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error("Failed to create upload directory %s: %s", upload_dir, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload directory could not be created. Check server file permissions.",
        )

    from app.services.zip_extract_service import extract_resumes_from_zip  # noqa: PLC0415

    created_ids: List[str] = []
    skipped: List[str] = []
    skipped_oversized: List[str] = []
    extracted_from_zip = 0

    for file in files:
        content = await file.read()

        if _is_zip_file(file):
            if len(content) > config.uploads.zip_max_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=(
                        f"ZIP file '{file.filename}' exceeds the "
                        f"{config.uploads.zip_max_bytes // (1024 * 1024)} MB size limit."
                    ),
                )
            try:
                extracted = extract_resumes_from_zip(content)
            except ValueError as exc:
                return JSONResponse(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    content={
                        "error": "invalid_zip",
                        "message": str(exc),
                    },
                )

            extracted_from_zip += len(extracted)
            for member_name, member_content in extracted:
                outcome, detail = await _ingest_resume_file(
                    job_id, actor.tenant_id, member_name, member_content, upload_dir, db
                )
                if outcome == "created" and detail:
                    created_ids.append(detail)
                elif outcome == "skipped" and detail:
                    skipped.append(detail)
                elif outcome == "oversized" and detail:
                    skipped_oversized.append(detail)
            continue

        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{file.filename}' exceeds the 20 MB size limit.",
            )

        filename = file.filename or f"{uuid.uuid4()}.pdf"
        outcome, detail = await _ingest_resume_file(
            job_id, actor.tenant_id, filename, content, upload_dir, db
        )
        if outcome == "created" and detail:
            created_ids.append(detail)
        elif outcome == "skipped" and detail:
            skipped.append(detail)

    for cid in created_ids:
        cand = await db.get(Candidate, uuid.UUID(cid))
        if cand:
            await log_change(
                db,
                actor=actor,
                action="candidate.uploaded",
                entity_type="candidate",
                entity_id=cand.id,
                subject_label=cand.original_filename or cand.name or cid,
                feature="resume",
                before=None,
                after={"original_filename": cand.original_filename},
                job_id=job_id,
            )

    await db.commit()

    from app.services.parse_queue_service import dispatch_parse_slots  # noqa: PLC0415

    await dispatch_parse_slots(db, job_id)

    log_event(
        logger,
        "%s uploaded %s for job \"%s\"%s%s%s",
        get_actor_label(),
        plural(len(created_ids), "resume"),
        job.title,
        f", skipped {plural(len(skipped), 'duplicate')}" if skipped else "",
        f", skipped {plural(skipped_oversized, 'oversized file')}" if skipped_oversized else "",
        f", including files from a zip archive" if extracted_from_zip else "",
    )
    if created_ids:
        logger.debug(
            "Accepted resume uploads for job \"%s\": %s",
            job.title,
            ", ".join(created_ids),
        )
    return ResumeUploadResponse(
        created=len(created_ids),
        skipped=len(skipped),
        skipped_files=skipped,
        candidate_ids=created_ids,
        extracted_from_zip=extracted_from_zip,
        skipped_oversized=skipped_oversized,
    )


# ---------------------------------------------------------------------------
# Task 3.8 — Candidate List
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/candidates", response_model=List[CandidateResponse])
async def list_candidates(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    parse_status: Optional[str] = Query(
        None,
        description="Comma-separated parse_status values, e.g. pending_parse or parsing,parsed",
    ),
    has_shortlist_result: Optional[bool] = Query(
        None,
        description="Filter candidates with (true) or without (false) a ShortlistResult row",
    ),
    db: AsyncSession = Depends(get_db),
):
    """List candidates for a job, optionally filtered by parse_status and shortlist state."""
    await get_tenant_job(db, job_id, actor.tenant_id)

    stmt = select(Candidate).where(Candidate.job_id == job_id)

    if parse_status:
        statuses = [s.strip() for s in parse_status.split(",") if s.strip()]
        if statuses:
            stmt = stmt.where(Candidate.parse_status.in_(statuses))

    if has_shortlist_result is not None:
        shortlist_exists = (
            select(ShortlistResult.id)
            .where(ShortlistResult.candidate_id == Candidate.id)
            .correlate(Candidate)
        )
        if has_shortlist_result:
            stmt = stmt.where(exists(shortlist_exists))
        else:
            stmt = stmt.where(~exists(shortlist_exists))

    stmt = stmt.order_by(Candidate.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Task 3.9 — Candidate Detail
# ---------------------------------------------------------------------------

@router.get("/candidates/{candidate_id}", response_model=CandidateResponse)
async def get_candidate(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """Return a single candidate by ID."""
    return await get_tenant_candidate(db, candidate_id, actor.tenant_id)


# ---------------------------------------------------------------------------
# Task A-2 — Retry Parse
# ---------------------------------------------------------------------------

@router.post(
    "/jobs/{job_id}/candidates/{candidate_id}/retry-parse",
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_parse(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    Re-queue a candidate's resume for parsing.

    Allowed when parse_status is 'parse_failed', 'ready', or a stuck in-progress
    state ('parse_queued', 'parsing', 'parsed') after a worker crash.
    Returns 202 Accepted immediately — parse pipeline runs async.
    """
    await get_tenant_job(db, job_id, actor.tenant_id)
    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)
    retryable = ("parse_failed", "ready", "parse_queued", "parsing", "parsed")
    if candidate.parse_status not in retryable:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Candidate is not in a retryable state",
        )
    before_status = candidate.parse_status
    candidate.parse_status = "pending_parse"
    candidate.parse_started_at = None
    await log_change(
        db,
        actor=actor,
        action="candidate.retry_parse",
        entity_type="candidate",
        entity_id=candidate.id,
        subject_label=candidate.original_filename or candidate.name or str(candidate_id),
        feature="parse_status",
        before={"parse_status": before_status},
        after={"parse_status": "pending_parse"},
        job_id=job_id,
    )
    await db.commit()
    from app.services.parse_queue_service import dispatch_parse_slots  # noqa: PLC0415

    await dispatch_parse_slots(db, job_id)
    log_event(
        logger,
        "%s re-queued parsing for %s",
        get_actor_label(),
        candidate.original_filename or candidate.name or "a candidate",
    )
    return {"status": "queued", "candidate_id": str(candidate_id)}


# ---------------------------------------------------------------------------
# Task B-9 — DELETE /api/candidates/{candidate_id}
# ---------------------------------------------------------------------------

@router.delete("/candidates/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_candidate(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a candidate and all related records.

    Candidate model has cascade='all, delete-orphan' on ShortlistResult,
    ScreeningCall, and InterviewSession relationships, so SQLAlchemy handles
    cascading deletes automatically.

    Also removes the resume file and any interview recording objects from storage.
    """
    from app.models.models import InterviewSession
    from app.services.parse_queue_service import dispatch_parse_slots  # noqa: PLC0415
    from app.services.s3_service import delete_objects, delete_stored_file  # noqa: PLC0415

    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)

    # Load interview sessions before cascade delete so we can clean recordings.
    sessions_result = await db.execute(
        select(InterviewSession).where(InterviewSession.candidate_id == candidate.id)
    )
    recording_keys = [
        s.recording_key
        for s in sessions_result.scalars().all()
        if s.recording_key
    ]

    job_id = candidate.job_id
    was_active = candidate.parse_status in ("parse_queued", "parsing", "parsed")
    label = candidate.original_filename or candidate.name or str(candidate_id)
    resume_path = candidate.resume_file_path

    await log_change(
        db,
        actor=actor,
        action="candidate.deleted",
        entity_type="candidate",
        entity_id=candidate.id,
        subject_label=label,
        feature="candidate",
        before={
            "name": candidate.name,
            "email": candidate.email,
            "original_filename": candidate.original_filename,
            "recording_keys": recording_keys,
        },
        after=None,
        job_id=job_id,
    )
    await db.delete(candidate)
    await db.commit()

    delete_stored_file(resume_path)
    if recording_keys:
        delete_objects(recording_keys)

    if was_active:
        await dispatch_parse_slots(db, job_id)
    return None


# ---------------------------------------------------------------------------
# Task A-1 — PATCH /api/candidates/{candidate_id}
# ---------------------------------------------------------------------------

@router.patch("/candidates/{candidate_id}", response_model=CandidateResponse)
async def update_candidate(
    candidate_id: uuid.UUID,
    body: CandidateUpdate,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    Partial update of a candidate's contact fields (name, email, phone).

    Only provided (non-None) fields are updated. Returns the updated candidate.
    """
    candidate = await get_tenant_candidate(db, candidate_id, actor.tenant_id)
    changes = {}
    if body.phone is not None:
        changes["phone"] = (candidate.phone, body.phone)
        candidate.phone = body.phone
    if body.name is not None:
        changes["name"] = (candidate.name, body.name)
        candidate.name = body.name
    if body.email is not None:
        changes["email"] = (candidate.email, body.email)
        candidate.email = body.email
    await log_field_changes(
        db,
        actor=actor,
        action="candidate.updated",
        entity_type="candidate",
        entity_id=candidate.id,
        subject_label=candidate.original_filename or candidate.name or str(candidate_id),
        changes=changes,
        job_id=candidate.job_id,
    )
    await db.commit()
    await db.refresh(candidate)
    return candidate
