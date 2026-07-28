import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, status

from app.dependencies import (
    RequireAdminOrHr,
    get_shortlist_service,
    get_shortlist_trigger_service,
    hr_roles,
)
from app.exceptions import DomainError
from app.schemas.schemas import (
    ShortlistDecisionResponse,
    ShortlistDecisionUpdate,
    ShortlistFeedbackCreate,
    ShortlistResultResponse,
    ShortlistResultWithCandidateResponse,
    ShortlistStatusResponse,
    ShortlistTriggerRequest,
)
from app.services.shortlist_service import ShortlistService
from app.services.shortlist_trigger_service import ShortlistTriggerService

router = APIRouter(dependencies=[Depends(hr_roles)])


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.post("/jobs/{job_id}/shortlist", status_code=status.HTTP_202_ACCEPTED)
async def trigger_shortlist(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    body: Optional[ShortlistTriggerRequest] = None,
    service: ShortlistTriggerService = Depends(get_shortlist_trigger_service),
):
    """Trigger AI shortlisting for a job."""
    return await service.trigger(actor, job_id, body)


@router.get(
    "/jobs/{job_id}/shortlist/status",
    response_model=ShortlistStatusResponse,
)
async def get_shortlist_status(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: ShortlistService = Depends(get_shortlist_service),
):
    """Return progress for the current or most recent shortlist batch."""
    return await service.get_status(actor, job_id)


@router.get(
    "/jobs/{job_id}/shortlist",
    response_model=List[ShortlistResultWithCandidateResponse],
)
async def get_shortlist(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: ShortlistService = Depends(get_shortlist_service),
):
    """Return all ShortlistResult records for a job, ordered by match_score desc."""
    return await service.list_results(actor, job_id)


@router.patch("/shortlist/{shortlist_id}/decision", response_model=ShortlistDecisionResponse)
async def update_decision(
    shortlist_id: uuid.UUID,
    payload: ShortlistDecisionUpdate,
    actor: RequireAdminOrHr,
    service: ShortlistService = Depends(get_shortlist_service),
):
    """Set HR decision on a shortlist result."""
    try:
        return await service.update_decision(actor, shortlist_id, payload)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/shortlist/{shortlist_id}/feedback", response_model=ShortlistResultResponse)
async def submit_feedback(
    shortlist_id: uuid.UUID,
    payload: ShortlistFeedbackCreate,
    actor: RequireAdminOrHr,
    service: ShortlistService = Depends(get_shortlist_service),
):
    """Submit HR feedback on a shortlist result."""
    try:
        return await service.submit_feedback(actor, shortlist_id, payload)
    except DomainError as exc:
        _raise_domain(exc)
