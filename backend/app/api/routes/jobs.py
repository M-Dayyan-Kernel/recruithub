import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import Job
from app.schemas.schemas import JobCreate, JobUpdate, JobResponse, JobParseResponse, InterviewQuestionPublic, ScreeningQuestion
from app.services.document_extractor import ALLOWED_EXTENSIONS, extract_text_from_bytes
from app.services.jd_parser import parse_job_description
from app.services.screening_defaults import get_default_screening_questions
from app.services.expected_answer_service import enrich_interview_questions

router = APIRouter()

MAX_JD_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _is_allowed_jd_file(file: UploadFile) -> bool:
    ct_ok = file.content_type in ALLOWED_CONTENT_TYPES
    ext_ok = Path(file.filename or "").suffix.lower() in ALLOWED_EXTENSIONS
    return ct_ok or ext_ok


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(payload: JobCreate, db: AsyncSession = Depends(get_db)):
    data = payload.model_dump()
    if not data.get("screening_questions"):
        data["screening_questions"] = get_default_screening_questions(data.get("title") or "")
    if data.get("interview_questions"):
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
        )
    job = Job(**data)
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


@router.get("", response_model=List[JobResponse])
async def list_jobs(
    status: Optional[str] = Query(None, description="Filter by job status (e.g. active, closed, draft)"),
    db: AsyncSession = Depends(get_db),
):
    query = select(Job).order_by(Job.created_at.desc())
    if status:
        query = query.where(Job.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/parse-jd", response_model=JobParseResponse)
async def parse_jd(file: UploadFile = File(...)):
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
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": "unsupported_file_type", "message": str(exc)},
        )
    except Exception as exc:
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
        parsed = await parse_job_description(raw_text)
    except Exception as exc:
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
async def get_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.patch("/{job_id}", response_model=JobResponse)
async def update_job(job_id: uuid.UUID, payload: JobUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    updates = payload.model_dump(exclude_unset=True)
    if "interview_questions" in updates and updates["interview_questions"] is not None:
        updates["interview_questions"] = await enrich_interview_questions(
            updates["interview_questions"],
            existing=job.interview_questions,
            job=job,
        )
    for field, value in updates.items():
        setattr(job, field, value)
    await db.commit()
    await db.refresh(job)
    return job


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """
    Delete a job and all related records.

    Job model has cascade='all, delete-orphan' on candidates, shortlist results,
    screening calls, and interview sessions.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await db.delete(job)
    await db.commit()
    return None
