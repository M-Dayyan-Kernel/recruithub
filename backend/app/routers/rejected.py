import uuid

from fastapi import APIRouter, Depends

from app.dependencies import RequireAdminOrHr, get_reject_service, hr_roles
from app.schemas.schemas import (
    ReconsiderResponse,
    RejectedListResponse,
    RejectionEmailRequest,
    RejectionEmailResponse,
    RejectResponse,
)
from app.services.reject_service import RejectService

router = APIRouter(dependencies=[Depends(hr_roles)])


@router.get("/jobs/{job_id}/rejected", response_model=RejectedListResponse)
async def list_rejected(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: RejectService = Depends(get_reject_service),
):
    """Everyone rejected on this job, with whether they have been told."""
    return await service.list_rejected(actor, job_id)


@router.post("/jobs/{job_id}/candidates/{candidate_id}/reject", response_model=RejectResponse)
async def reject_candidate(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: RejectService = Depends(get_reject_service),
):
    """Move the candidate to Rejected from whichever stage they are in. No email is sent."""
    return await service.reject(actor, job_id, candidate_id)


@router.post("/jobs/{job_id}/rejected/{candidate_id}/reconsider", response_model=ReconsiderResponse)
async def reconsider_candidate(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: RejectService = Depends(get_reject_service),
):
    """Put a rejected candidate back where they were rejected from (until they are emailed)."""
    return await service.reconsider(actor, job_id, candidate_id)


@router.post("/jobs/{job_id}/rejected/email", response_model=RejectionEmailResponse)
async def email_rejected(
    job_id: uuid.UUID,
    body: RejectionEmailRequest,
    actor: RequireAdminOrHr,
    service: RejectService = Depends(get_reject_service),
):
    """Send the rejection email to up to 10 rejected candidates. Final for each one."""
    return await service.send_rejection_emails(actor, job_id, body.candidate_ids)
