import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile, status

from app.core.pagination import PaginationParams
from app.dependencies import (
    RequireAdminOrHr,
    get_candidate_directory_service,
    get_candidate_service,
    get_resume_upload_service,
    hr_roles,
)
from app.exceptions import DomainError
from app.schemas.schemas import (
    CandidateListItem,
    CandidateProfileResponse,
    CandidateResponse,
    CandidateUpdate,
    PaginatedResponse,
    ResumeUploadResponse,
)
from app.services.candidate_directory_service import CandidateDirectoryService
from app.services.candidate_stage_filter import CandidateStageFilter
from app.services.candidate_service import CandidateService
from app.services.resume_upload_service import ResumeUploadService

router = APIRouter(dependencies=[Depends(hr_roles)])


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.get("/candidates", response_model=PaginatedResponse)
async def list_tenant_candidates(
    actor: RequireAdminOrHr,
    pagination: PaginationParams = Depends(),
    job_id: Optional[uuid.UUID] = Query(None, description="Filter by job"),
    stage: Optional[CandidateStageFilter] = Query(
        None,
        description="Filter by hiring stage: ai_shortlisted, screening, interview, finalists",
    ),
    q: Optional[str] = Query(None, description="Search candidate name"),
    service: CandidateDirectoryService = Depends(get_candidate_directory_service),
):
    """List all candidates in the tenant with optional job, stage, and name search."""
    return await service.list(actor, job_id=job_id, stage=stage, q=q, pagination=pagination)


@router.post(
    "/jobs/{job_id}/resumes",
    response_model=ResumeUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_resumes(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    files: List[UploadFile] = File(...),
    service: ResumeUploadService = Depends(get_resume_upload_service),
):
    """Upload resume files (PDF / DOCX) or ZIP archives containing them."""
    return await service.upload(actor, job_id, files)


@router.get("/jobs/{job_id}/candidates", response_model=PaginatedResponse)
async def list_candidates(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    pagination: PaginationParams = Depends(),
    pipeline_status: Optional[str] = Query(
        None,
        description="Comma-separated pipeline_status values, e.g. queued or processing,completed",
    ),
    parse_status: Optional[str] = Query(
        None,
        deprecated=True,
        description="Deprecated alias for pipeline_status",
    ),
    has_shortlist_result: Optional[bool] = Query(
        None,
        description="Filter candidates with (true) or without (false) a ShortlistResult row",
    ),
    service: CandidateService = Depends(get_candidate_service),
):
    """List candidates for a job, optionally filtered by pipeline_status and shortlist state."""
    return await service.list(
        actor,
        job_id,
        pipeline_status=pipeline_status,
        parse_status=parse_status,
        has_shortlist_result=has_shortlist_result,
        pagination=pagination,
    )


@router.get("/candidates/{candidate_id}", response_model=CandidateProfileResponse)
async def get_candidate(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: CandidateDirectoryService = Depends(get_candidate_directory_service),
):
    """Return a candidate profile for the directory module."""
    try:
        return await service.get_profile(actor, candidate_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.post(
    "/jobs/{job_id}/candidates/{candidate_id}/retry-processing",
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_processing(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: CandidateService = Depends(get_candidate_service),
):
    """Re-queue a candidate for AI resume review and shortlisting."""
    try:
        return await service.retry_processing(actor, job_id, candidate_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.post(
    "/jobs/{job_id}/candidates/{candidate_id}/retry-parse",
    status_code=status.HTTP_202_ACCEPTED,
    deprecated=True,
)
async def retry_parse(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: CandidateService = Depends(get_candidate_service),
):
    """Deprecated alias for retry-processing."""
    return await retry_processing(job_id, candidate_id, actor, service)


@router.delete("/candidates/{candidate_id}/gdpr-erase", status_code=status.HTTP_204_NO_CONTENT)
async def gdpr_erase_candidate(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: CandidateService = Depends(get_candidate_service),
):
    """Erase candidate PII while retaining anonymized referential rows."""
    await service.gdpr_erase(actor, candidate_id)


@router.delete("/candidates/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_candidate(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: CandidateService = Depends(get_candidate_service),
):
    """Delete a candidate and all related records."""
    await service.delete(actor, candidate_id)


@router.patch("/candidates/{candidate_id}", response_model=CandidateResponse)
async def update_candidate(
    candidate_id: uuid.UUID,
    body: CandidateUpdate,
    actor: RequireAdminOrHr,
    service: CandidateService = Depends(get_candidate_service),
):
    """Partial update of a candidate's editable fields."""
    return await service.update(actor, candidate_id, body)
