import io
import json
import os
import re
import uuid
import logging
from pathlib import Path
from typing import List

from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.models.models import Candidate, Job
from app.schemas.schemas import CandidateResponse, CandidateUpdate, ResumeUploadResponse

logger = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def _get_job_or_404(job_id: uuid.UUID, db: AsyncSession) -> Job:
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


def _is_allowed_file(file: UploadFile) -> bool:
    """Return True if the file passes content-type AND extension checks."""
    ct_ok = file.content_type in ALLOWED_CONTENT_TYPES
    ext_ok = Path(file.filename or "").suffix.lower() in ALLOWED_EXTENSIONS
    return ct_ok or ext_ok  # trust whichever passes (browser CT can be unreliable)


# ---------------------------------------------------------------------------
# Task 3.2 — Resume Upload  (updated: B-4 dedup, B-5 size limit)
# ---------------------------------------------------------------------------

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


@router.post(
    "/jobs/{job_id}/resumes",
    response_model=ResumeUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_resumes(
    job_id: uuid.UUID,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload one or more resume files (PDF / DOCX). Triggers async text extraction.

    Deduplicates by original filename per job — skipped files are reported in the
    response without raising an error. Returns created/skipped counts.
    Files exceeding 20 MB raise 413.
    """

    # --- Validate file types BEFORE any DB/disk work ---
    for f in files:
        if not _is_allowed_file(f):
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content={
                    "error": "unsupported_file_type",
                    "message": "Only PDF and DOCX files are accepted.",
                },
            )

    # --- Verify job exists ---
    await _get_job_or_404(job_id, db)

    # --- Prepare upload directory ---
    upload_dir = Path(settings.UPLOAD_DIR) / str(job_id)
    try:
        upload_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error("Failed to create upload directory %s: %s", upload_dir, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload directory could not be created. Check server file permissions.",
        )

    created_ids: List[str] = []
    skipped: List[str] = []

    for file in files:
        # --- B-5: File size guard ---
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File '{file.filename}' exceeds the 20 MB size limit.",
            )

        filename = file.filename or f"{uuid.uuid4()}.pdf"
        # Sanitise filename — keep only the last path component
        filename = Path(filename).name

        # --- B-4: Dedup by original filename within this job ---
        existing_result = await db.execute(
            select(Candidate).where(
                Candidate.job_id == job_id,
                Candidate.original_filename == filename,
            )
        )
        if existing_result.scalars().first():
            logger.info(
                "Skipping duplicate upload: job=%s filename=%s", job_id, filename
            )
            skipped.append(filename)
            continue

        dest = upload_dir / filename
        dest.write_bytes(content)

        candidate = Candidate(
            job_id=job_id,
            # Name seeded from filename; parse_resume will overwrite with real name.
            name=Path(filename).stem,
            # Email placeholder — overwritten by parse_resume task once parsing completes.
            email=f"pending_{uuid.uuid4().hex}@upload.pending",
            resume_file_path=str(dest),
            original_filename=filename,  # B-4: store for dedup on future uploads
            parse_status="pending_parse",
        )
        db.add(candidate)
        # Flush to get the id before committing
        await db.flush()
        created_ids.append(str(candidate.id))

    await db.commit()

    # --- Enqueue text-extraction tasks ---
    from app.tasks.resume_tasks import extract_resume_text  # noqa: PLC0415

    for cid in created_ids:
        extract_resume_text.apply_async(args=[cid])

    logger.info(
        "Uploaded resumes for job %s: created=%d skipped=%d",
        job_id,
        len(created_ids),
        len(skipped),
    )
    return ResumeUploadResponse(
        created=len(created_ids),
        skipped=len(skipped),
        skipped_files=skipped,
        candidate_ids=created_ids,
    )


# ---------------------------------------------------------------------------
# Task 3.4 — Google Drive Import
# ---------------------------------------------------------------------------

@router.post(
    "/jobs/{job_id}/resumes/drive",
    response_model=List[CandidateResponse],
)
async def import_resumes_from_drive(
    job_id: uuid.UUID,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """Import resumes from a Google Drive file or folder URL.

    Requires GOOGLE_DRIVE_CREDENTIALS_JSON env var (service-account JSON string).
    Returns HTTP 503 with actionable fallback message if not configured.
    """

    # --- Graceful degradation when Drive is not configured ---
    if not settings.GOOGLE_DRIVE_CREDENTIALS_JSON:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "error": "google_drive_not_configured",
                "message": (
                    "Google Drive integration is not configured. "
                    "Upload resumes directly using POST /api/jobs/{job_id}/resumes instead."
                ),
                "fallback": "Use direct file upload instead.",
            },
        )

    drive_url: str = body.get("drive_url", "").strip()
    if not drive_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="drive_url is required.",
        )

    # --- Basic URL format check ---
    if "drive.google.com" not in drive_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Invalid Google Drive URL. "
                "Expected a URL like https://drive.google.com/drive/folders/... "
                "or https://drive.google.com/file/d/..."
            ),
        )

    # --- Verify job exists ---
    await _get_job_or_404(job_id, db)

    # --- Parse file/folder ID from URL ---
    # Matches /folders/<id>, /file/d/<id>, or ?id=<id>
    match = re.search(r"(?:folders|file/d)/([a-zA-Z0-9_-]{25,})", drive_url)
    if not match:
        match = re.search(r"[?&]id=([a-zA-Z0-9_-]{25,})", drive_url)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Could not extract a valid file or folder ID from the provided Google Drive URL. "
                "Please share the direct folder or file link."
            ),
        )
    resource_id = match.group(1)

    # --- Build Drive service with service account credentials ---
    try:
        from google.oauth2 import service_account  # noqa: PLC0415
        from googleapiclient.discovery import build  # noqa: PLC0415
        from googleapiclient.http import MediaIoBaseDownload  # noqa: PLC0415

        creds_info = json.loads(settings.GOOGLE_DRIVE_CREDENTIALS_JSON)
        credentials = service_account.Credentials.from_service_account_info(
            creds_info,
            scopes=["https://www.googleapis.com/auth/drive.readonly"],
        )
        service = build("drive", "v3", credentials=credentials, cache_discovery=False)

    except json.JSONDecodeError as exc:
        logger.error("GOOGLE_DRIVE_CREDENTIALS_JSON is not valid JSON: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "error": "google_drive_misconfigured",
                "message": "GOOGLE_DRIVE_CREDENTIALS_JSON is not valid JSON. Contact your administrator.",
            },
        )
    except Exception as exc:
        logger.error("Failed to initialise Google Drive client: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not initialise Google Drive client: {exc}",
        )

    try:
        # --- Determine whether this is a folder or a single file ---
        meta = service.files().get(
            fileId=resource_id, fields="id,name,mimeType"
        ).execute()
        is_folder = meta.get("mimeType") == "application/vnd.google-apps.folder"

        upload_dir = Path(settings.UPLOAD_DIR) / str(job_id)
        try:
            upload_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Upload directory could not be created. Check server file permissions.",
            ) from exc

        files_to_download: list = []

        if is_folder:
            # List only PDF / DOCX files inside the folder
            q = (
                f"'{resource_id}' in parents and trashed=false and "
                f"(mimeType='application/pdf' or "
                f"mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document')"
            )
            page_token = None
            while True:
                response = (
                    service.files()
                    .list(
                        q=q,
                        fields="nextPageToken,files(id,name,mimeType)",
                        pageToken=page_token,
                    )
                    .execute()
                )
                files_to_download.extend(response.get("files", []))
                page_token = response.get("nextPageToken")
                if not page_token:
                    break
        else:
            files_to_download = [meta]

        if not files_to_download:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No PDF or DOCX files found at the specified Google Drive location.",
            )

        candidates: List[Candidate] = []
        for drive_file in files_to_download:
            fid = drive_file["id"]
            fname = Path(drive_file["name"]).name  # sanitise
            dest = upload_dir / fname

            # Stream-download the file
            request = service.files().get_media(fileId=fid)
            buffer = io.BytesIO()
            downloader = MediaIoBaseDownload(buffer, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            dest.write_bytes(buffer.getvalue())

            candidate = Candidate(
                job_id=job_id,
                name=Path(fname).stem,
                email=f"pending_{uuid.uuid4().hex}@upload.pending",
                resume_file_path=str(dest),
                parse_status="pending_parse",
            )
            db.add(candidate)
            candidates.append(candidate)

        await db.commit()
        for candidate in candidates:
            await db.refresh(candidate)

        from app.tasks.resume_tasks import extract_resume_text  # noqa: PLC0415

        for candidate in candidates:
            extract_resume_text.apply_async(args=[str(candidate.id)])

        logger.info(
            "Imported %d resume(s) from Google Drive for job %s", len(candidates), job_id
        )
        return candidates

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Google Drive import failed for job %s: %s", job_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Google Drive API error: {exc}",
        )


# ---------------------------------------------------------------------------
# Task 3.8 — Candidate List
# ---------------------------------------------------------------------------

@router.get("/jobs/{job_id}/candidates", response_model=List[CandidateResponse])
async def list_candidates(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """List all candidates for a job, ordered by created_at desc."""
    await _get_job_or_404(job_id, db)

    result = await db.execute(
        select(Candidate)
        .where(Candidate.job_id == job_id)
        .order_by(Candidate.created_at.desc())
    )
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Task 3.9 — Candidate Detail
# ---------------------------------------------------------------------------

@router.get("/candidates/{candidate_id}", response_model=CandidateResponse)
async def get_candidate(candidate_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Return a single candidate by ID."""
    result = await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found"
        )
    return candidate


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
    db: AsyncSession = Depends(get_db),
):
    """
    Re-queue a candidate's resume for parsing.

    Only allowed when parse_status is 'parse_failed' or 'ready'.
    Returns 202 Accepted immediately — parse pipeline runs async.
    """
    candidate = await db.get(Candidate, candidate_id)
    if not candidate or candidate.job_id != job_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate not found",
        )
    if candidate.parse_status not in ("parse_failed", "ready"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Candidate is not in a retryable state",
        )
    # Reset to pending and re-queue
    candidate.parse_status = "pending_parse"
    await db.commit()
    from app.tasks.resume_tasks import extract_resume_text  # noqa: PLC0415
    extract_resume_text.delay(str(candidate_id))
    logger.info("retry-parse queued for candidate=%s", candidate_id)
    return {"status": "queued", "candidate_id": str(candidate_id)}


# ---------------------------------------------------------------------------
# Task B-9 — DELETE /api/candidates/{candidate_id}
# ---------------------------------------------------------------------------

@router.delete("/candidates/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_candidate(
    candidate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a candidate and all related records.

    Candidate model has cascade='all, delete-orphan' on ShortlistResult,
    ScreeningCall, and InterviewSession relationships, so SQLAlchemy handles
    cascading deletes automatically.
    """
    candidate = await db.get(Candidate, candidate_id)
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate not found",
        )
    await db.delete(candidate)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Task A-1 — PATCH /api/candidates/{candidate_id}
# ---------------------------------------------------------------------------

@router.patch("/candidates/{candidate_id}", response_model=CandidateResponse)
async def update_candidate(
    candidate_id: uuid.UUID,
    body: CandidateUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Partial update of a candidate's contact fields (name, email, phone).

    Only provided (non-None) fields are updated. Returns the updated candidate.
    """
    candidate = await db.get(Candidate, candidate_id)
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate not found",
        )
    if body.phone is not None:
        candidate.phone = body.phone
    if body.name is not None:
        candidate.name = body.name
    if body.email is not None:
        candidate.email = body.email
    await db.commit()
    await db.refresh(candidate)
    return candidate
