"""
Interviews Router — Sprint 6

Endpoints for LiveKit interview session management.
"""

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, Query, Request, status

from app.dependencies import (
    RequireAdminOrHr,
    get_interview_hr_service,
    get_interview_public_service,
    get_interview_report_service,
    get_interview_webhook_service,
    hr_roles,
)
from app.schemas.schemas import (
    FinalistsResponse,
    InterviewHrDecisionUpdate,
    InterviewPipelineResponse,
    InterviewReportResponse,
    InterviewScheduleRequest,
    InterviewSessionResponse,
    InterviewStartResponse,
)
from app.services.interview_hr_service import InterviewHrService
from app.services.interview_public_service import InterviewPublicService
from app.services.interview_report_service import InterviewReportService
from app.services.interview_webhook_service import InterviewWebhookService

_hr_auth = Depends(hr_roles)

router = APIRouter()


@router.post(
    "/candidates/{candidate_id}/interview/queue",
    status_code=status.HTTP_200_OK,
    dependencies=[_hr_auth],
)
async def queue_candidate_for_interview(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.queue(actor, candidate_id)


@router.post(
    "/candidates/{candidate_id}/interview/schedule",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_hr_auth],
)
async def schedule_interview(
    candidate_id: uuid.UUID,
    body: InterviewScheduleRequest,
    actor: RequireAdminOrHr,
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.schedule(actor, candidate_id, body)


@router.post(
    "/candidates/{candidate_id}/interview/send",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_hr_auth],
)
async def send_interview_link(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.send_link(actor, candidate_id)


@router.get("/interview/{token}", response_model=InterviewSessionResponse)
async def get_session_by_token(
    token: str,
    service: InterviewPublicService = Depends(get_interview_public_service),
):
    return await service.get_session(token)


@router.post("/interview/{token}/start", response_model=InterviewStartResponse)
async def start_interview(
    token: str,
    service: InterviewPublicService = Depends(get_interview_public_service),
):
    return await service.start(token)


@router.post("/interview/{token}/complete", status_code=status.HTTP_202_ACCEPTED)
async def complete_interview(
    token: str,
    service: InterviewPublicService = Depends(get_interview_public_service),
):
    return await service.complete(token)


@router.post("/livekit/webhook", status_code=status.HTTP_200_OK)
async def livekit_webhook(
    request: Request,
    service: InterviewWebhookService = Depends(get_interview_webhook_service),
):
    return await service.handle_event(request)


@router.get(
    "/candidates/{candidate_id}/report",
    response_model=InterviewReportResponse,
    dependencies=[_hr_auth],
)
async def get_interview_report(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: InterviewReportService = Depends(get_interview_report_service),
):
    return await service.get_report(actor, candidate_id)


@router.post(
    "/candidates/{candidate_id}/report/refresh",
    response_model=InterviewReportResponse,
    dependencies=[_hr_auth],
)
async def refresh_interview_report(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: InterviewReportService = Depends(get_interview_report_service),
):
    return await service.refresh_report(actor, candidate_id)


@router.get(
    "/jobs/{job_id}/interviews",
    response_model=list[InterviewSessionResponse],
    dependencies=[_hr_auth],
)
async def list_job_interviews(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.list_for_job(actor, job_id)


@router.get(
    "/jobs/{job_id}/interviews/pipeline",
    response_model=InterviewPipelineResponse,
    dependencies=[_hr_auth],
)
async def get_interview_pipeline(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    tab: Optional[
        Literal["pending", "scheduled", "ongoing", "completed", "flagged", "finalists"]
    ] = Query(
        default=None,
        description="Filter candidates to a single pipeline tab. Counts always reflect all tabs.",
    ),
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.get_pipeline(actor, job_id, tab=tab)


@router.get(
    "/jobs/{job_id}/finalists",
    response_model=FinalistsResponse,
    dependencies=[_hr_auth],
)
async def get_finalists(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.get_finalists(actor, job_id)


@router.patch(
    "/candidates/{candidate_id}/interview/decision",
    response_model=InterviewSessionResponse,
    dependencies=[_hr_auth],
)
async def update_interview_hr_decision(
    candidate_id: uuid.UUID,
    payload: InterviewHrDecisionUpdate,
    actor: RequireAdminOrHr,
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.update_decision(actor, candidate_id, payload)


@router.post(
    "/candidates/{candidate_id}/interview/resend-email",
    response_model=InterviewSessionResponse,
    dependencies=[_hr_auth],
)
async def resend_interview_email(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.resend_email(actor, candidate_id)


@router.post(
    "/candidates/{candidate_id}/interview/reschedule",
    response_model=InterviewSessionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[_hr_auth],
)
async def reschedule_interview_endpoint(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    body: Optional[InterviewScheduleRequest] = Body(None),
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.reschedule(actor, candidate_id, body)


@router.post(
    "/candidates/{candidate_id}/interview/retry-assessment",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[_hr_auth],
)
async def retry_interview_assessment(
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: InterviewHrService = Depends(get_interview_hr_service),
):
    return await service.retry_assessment(actor, candidate_id)
