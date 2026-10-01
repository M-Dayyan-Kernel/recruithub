import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile, status

from app.dependencies import (
    RequireAdminOrHr,
    get_job_description_parse_service,
    get_job_service,
    hr_roles,
)
from app.exceptions import DomainError
from app.schemas.schemas import JobCreate, JobParseResponse, JobResponse, JobUpdate
from app.services.job_description_parse_service import JobDescriptionParseService
from app.services.job_service import JobService

router = APIRouter(dependencies=[Depends(hr_roles)])


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.post("", response_model=JobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(
    payload: JobCreate,
    actor: RequireAdminOrHr,
    service: JobService = Depends(get_job_service),
):
    try:
        return await service.create(actor, payload)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("", response_model=List[JobResponse])
async def list_jobs(
    actor: RequireAdminOrHr,
    status: Optional[str] = Query(None, description="Filter by job status (e.g. active, closed, draft)"),
    service: JobService = Depends(get_job_service),
):
    return await service.list(actor, status)


@router.post("/parse-jd", response_model=JobParseResponse)
async def parse_jd(
    actor: RequireAdminOrHr,
    file: UploadFile = File(...),
    service: JobDescriptionParseService = Depends(get_job_description_parse_service),
):
    """Extract and parse a job description from an uploaded PDF or DOCX file."""
    try:
        return await service.parse_upload(file, actor.tenant_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: JobService = Depends(get_job_service),
):
    try:
        return await service.get(actor, job_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.patch("/{job_id}", response_model=JobResponse)
async def update_job(
    job_id: uuid.UUID,
    payload: JobUpdate,
    actor: RequireAdminOrHr,
    service: JobService = Depends(get_job_service),
):
    try:
        return await service.update(actor, job_id, payload)
    except DomainError as exc:
        _raise_domain(exc)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: JobService = Depends(get_job_service),
):
    """
    Delete a job and all related records.

    Job model has cascade='all, delete-orphan' on candidates, shortlist results,
    screening calls, and interview sessions.
    """
    try:
        await service.delete(actor, job_id)
    except DomainError as exc:
        _raise_domain(exc)
