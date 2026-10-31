import uuid
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile, status

from app.dependencies import (
    RequireAdminOrHr,
    get_job_description_parse_service,
    get_job_service,
    get_voice_screening_service,
    hr_roles,
)
from app.exceptions import DomainError
from app.schemas.schemas import (
    InterviewTopicRegenerateRequest,
    InterviewTopicRegenerateResponse,
    InterviewTopicsRequest,
    InterviewTopicsResponse,
    JobCreate,
    JobParseResponse,
    JobResponse,
    JobUpdate,
    StandardScreeningQuestionsResponse,
    VoiceScreeningChange,
    VoiceScreeningChangeResult,
    VoiceScreeningPreview,
)
from app.services.job_description_parse_service import JobDescriptionParseService
from app.services.job_service import JobService
from app.services.screening_defaults import build_standard_questions, clean_work_location, parse_work_mode

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


@router.post("/topics/generate", response_model=InterviewTopicsResponse)
async def generate_interview_topics(
    payload: InterviewTopicsRequest,
    actor: RequireAdminOrHr,
    service: JobService = Depends(get_job_service),
):
    """Write a topic pool for a job from its description (saved or not). Nothing is stored."""
    try:
        return await service.generate_topics(actor, payload)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/topics/regenerate", response_model=InterviewTopicRegenerateResponse)
async def regenerate_interview_topic(
    payload: InterviewTopicRegenerateRequest,
    actor: RequireAdminOrHr,
    service: JobService = Depends(get_job_service),
):
    """Write a replacement for one topic of the pool being edited. Nothing is stored."""
    try:
        return await service.regenerate_topic(actor, payload)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/standard-screening-questions", response_model=StandardScreeningQuestionsResponse)
async def standard_screening_questions(
    title: str = Query("", description="The job title, used in the experience question"),
    work_mode: Optional[str] = Query(None, description="remote, hybrid or onsite"),
    work_location: Optional[str] = Query(None),
):
    """The locked screening questions for these job details, so the form can show them before the
    job exists. A preview only: creating or updating a job always rebuilds them on the server.
    Registered before /{job_id}, which would otherwise take this path."""
    return StandardScreeningQuestionsResponse(
        standard=build_standard_questions(
            title, parse_work_mode(work_mode), clean_work_location(work_location)
        )
    )


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


@router.get("/{job_id}/voice-screening", response_model=VoiceScreeningPreview)
async def preview_voice_screening(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service=Depends(get_voice_screening_service),
):
    """Who the voice-screening switch would affect (shown before it is flipped)."""
    try:
        return await service.preview(actor, job_id)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/{job_id}/voice-screening", response_model=VoiceScreeningChangeResult)
async def change_voice_screening(
    job_id: uuid.UUID,
    body: VoiceScreeningChange,
    actor: RequireAdminOrHr,
    background_tasks: BackgroundTasks,
    service=Depends(get_voice_screening_service),
):
    try:
        return await service.change(actor, job_id, body, run_later=background_tasks.add_task)
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
