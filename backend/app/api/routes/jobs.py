import logging
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config_loader import config
from app.core.database import get_db
from app.core.deps import RequireAdminOrHr, hr_roles
from app.core.tenancy import get_tenant_job
from app.models.models import Job
from app.schemas.schemas import JobCreate, JobUpdate, JobResponse, JobParseResponse, InterviewQuestionPublic, ScreeningQuestion
from app.services.audit_service import log_change, log_field_changes
from app.services.document_extractor import ALLOWED_EXTENSIONS, extract_text_from_bytes
from app.services.jd_parser import parse_job_description
from app.services.screening_defaults import get_default_screening_questions
from app.services.expected_answer_service import enrich_interview_questions
from app.services.tenant_integrations_service import load_tenant_integrations

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(hr_roles)])

MAX_JD_FILE_SIZE = config.uploads.jd_max_bytes
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

_JOB_AUDIT_FIELDS = (
    "title",
    "description",
    "required_skills",
    "experience_min",
    "experience_max",
    "screening_questions",
    "interview_questions",
    "screening_call_from",
    "screening_call_to",
    "screening_timezone",
    "voice_screening_enabled",
    "status",
)


def _is_allowed_jd_file(file: UploadFile) -> bool:
    ct_ok = file.content_type in ALLOWED_CONTENT_TYPES
    ext_ok = Path(file.filename or "").suffix.lower() in ALLOWED_EXTENSIONS
    return ct_ok or ext_ok


def _serialize_job_field(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(
    payload: JobCreate,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump()
    if not data.get("screening_questions"):
        data["screening_questions"] = get_default_screening_questions(data.get("title") or "")
    if data.get("interview_questions"):
        integrations = await load_tenant_integrations(db, actor.tenant_id)
        integrations.require("openai_api_key")
        context_job = Job(
            title=data["title"],
            description=data["description"],
            required_skills=data.get("required_skills"),
            experience_min=data.get("experience_min", 0),
            experience_max=data.get("experience_max", 0),
        )
        data["interview_questions"] = await enrich_interview_questions(
            data["interview_questions"],
            existing=None,
            job=context_job,
            api_key=integrations.openai_api_key,
        )
    job = Job(**data, tenant_id=actor.tenant_id)
    db.add(job)
    await db.flush()
    await log_change(
        db,
        actor=actor,
        action="job.created",
        entity_type="job",
        entity_id=job.id,
        subject_label=job.title,
        feature="job",
        before=None,
        after={"title": job.title, "status": job.status},
        job_id=job.id,
    )
    await db.commit()
    await db.refresh(job)
    return job


@router.get("", response_model=List[JobResponse])
async def list_jobs(
    actor: RequireAdminOrHr,
    status: Optional[str] = Query(None, description="Filter by job status (e.g. active, closed, draft)"),
    db: AsyncSession = Depends(get_db),
):
    query = select(Job).where(Job.tenant_id == actor.tenant_id).order_by(Job.created_at.desc())
    if status:
        query = query.where(Job.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/parse-jd", response_model=JobParseResponse)
async def parse_jd(
    actor: RequireAdminOrHr,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Extract and parse a job description from an uploaded PDF or DOCX file."""
    if not _is_allowed_jd_file(file):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": "unsupported_file_type",
                "message": "Only PDF and DOCX files are accepted.",
            },
        )

    content = await file.read()
    if len(content) > MAX_JD_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds the {MAX_JD_FILE_SIZE // (1024 * 1024)} MB size limit.",
        )

    filename = file.filename or "upload.pdf"
    try:
        raw_text = extract_text_from_bytes(content, filename)
    except ValueError as exc:
        logger.warning("JD extract rejected for %s: %s", filename, exc)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": "unsupported_file_type", "message": str(exc)},
        )
    except Exception as exc:
        logger.exception("JD text extraction failed for %s", filename)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not read file: {exc}",
        ) from exc

    if not raw_text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No text could be extracted from the document.",
        )

    try:
        integrations = await load_tenant_integrations(db, actor.tenant_id)
        integrations.require("openai_api_key")
        parsed = await parse_job_description(raw_text, integrations.openai_api_key)
    except ValueError as exc:
        logger.warning("JD parse unavailable for tenant %s: %s", actor.tenant_id, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("JD parse failed for tenant %s file %s", actor.tenant_id, filename)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse job description: {exc}",
        ) from exc

    if not (parsed.get("title") or "").strip() and not (parsed.get("description") or "").strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not extract a job title or description from the document.",
        )

    return JobParseResponse(
        title=(parsed.get("title") or "").strip(),
        description=(parsed.get("description") or "").strip(),
        required_skills=parsed.get("required_skills") or [],
        experience_min=parsed.get("experience_min"),
        experience_max=parsed.get("experience_max"),
        screening_questions=[
            ScreeningQuestion(**q) for q in (parsed.get("screening_questions") or [])
        ],
        interview_questions=[
            InterviewQuestionPublic(**q) for q in (parsed.get("interview_questions") or [])
        ],
    )


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    return await get_tenant_job(db, job_id, actor.tenant_id)


@router.patch("/{job_id}", response_model=JobResponse)
async def update_job(
    job_id: uuid.UUID,
    payload: JobUpdate,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    job = await get_tenant_job(db, job_id, actor.tenant_id)
    updates = payload.model_dump(exclude_unset=True)
    if "interview_questions" in updates and updates["interview_questions"] is not None:
        integrations = await load_tenant_integrations(db, actor.tenant_id)
        integrations.require("openai_api_key")
        updates["interview_questions"] = await enrich_interview_questions(
            updates["interview_questions"],
            existing=job.interview_questions,
            job=job,
            api_key=integrations.openai_api_key,
        )

    changes = {}
    for field in _JOB_AUDIT_FIELDS:
        if field not in updates:
            continue
        before_val = _serialize_job_field(getattr(job, field))
        after_val = _serialize_job_field(updates[field])
        changes[field] = (before_val, after_val)

    for field, value in updates.items():
        setattr(job, field, value)

    await log_field_changes(
        db,
        actor=actor,
        action="job.updated",
        entity_type="job",
        entity_id=job.id,
        subject_label=job.title,
        changes=changes,
        job_id=job.id,
    )
    await db.commit()
    await db.refresh(job)
    return job


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a job and all related records.

    Job model has cascade='all, delete-orphan' on candidates, shortlist results,
    screening calls, and interview sessions.
    """
    job = await get_tenant_job(db, job_id, actor.tenant_id)
    title = job.title
    status_before = job.status
    await log_change(
        db,
        actor=actor,
        action="job.deleted",
        entity_type="job",
        entity_id=job.id,
        subject_label=title,
        feature="job",
        before={"title": title, "status": status_before},
        after=None,
        job_id=job.id,
    )
    await db.delete(job)
    await db.commit()
    return None
