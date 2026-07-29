from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.dependencies import RequireSuperAdmin
from app.exceptions import DomainError
from app.modules.talentos_integration.talentos_integration_schema import (
    TalentosCandidateCreate,
    TalentosCandidateResponse,
    TalentosInterviewResponse,
    TalentosInterviewTriggerResponse,
    TalentosJobCreate,
    TalentosJobResponse,
    TalentosScreeningResultResponse,
    TalentosScreeningTriggerResponse,
)
from app.modules.talentos_integration.talentos_integration_service import (
    TalentosIntegrationService,
)

router = APIRouter(
    prefix="/internal/talentos",
    tags=["talentos-integration"],
    dependencies=[Depends(RequireSuperAdmin)],
)


def _get_service(db: AsyncSession = Depends(get_db)) -> TalentosIntegrationService:
    return TalentosIntegrationService(db)


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.post("/jobs", response_model=TalentosJobResponse, status_code=status.HTTP_201_CREATED)
async def create_job(
    payload: TalentosJobCreate,
    actor: RequireSuperAdmin,
    service: TalentosIntegrationService = Depends(_get_service),
):
    try:
        job = await service.create_job(actor, payload)
        return TalentosJobResponse.model_validate(job)
    except DomainError as exc:
        _raise_domain(exc)


@router.post("/jobs/{job_id}/candidates", response_model=TalentosCandidateResponse, status_code=status.HTTP_201_CREATED)
async def create_candidate(
    job_id: uuid.UUID,
    payload: TalentosCandidateCreate,
    actor: RequireSuperAdmin,
    service: TalentosIntegrationService = Depends(_get_service),
):
    try:
        candidate = await service.create_candidate(actor, job_id, payload)
        return TalentosCandidateResponse.model_validate(candidate)
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/jobs/{job_id}/candidates", response_model=List[TalentosCandidateResponse])
async def list_candidates(
    job_id: uuid.UUID,
    actor: RequireSuperAdmin,
    service: TalentosIntegrationService = Depends(_get_service),
):
    candidates = await service.list_candidates(actor, job_id)
    return [TalentosCandidateResponse.model_validate(c) for c in candidates]


@router.post("/jobs/{job_id}/candidates/{candidate_id}/trigger-screening", response_model=TalentosScreeningTriggerResponse)
async def trigger_screening(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireSuperAdmin,
    service: TalentosIntegrationService = Depends(_get_service),
):
    try:
        call = await service.trigger_screening(actor, job_id, candidate_id)
        return TalentosScreeningTriggerResponse(screening_call_id=call.id, status="triggered")
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/jobs/{job_id}/candidates/{candidate_id}/screening", response_model=TalentosScreeningResultResponse)
async def get_screening_result(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireSuperAdmin,
    service: TalentosIntegrationService = Depends(_get_service),
):
    call = await service.get_screening_result(actor, job_id, candidate_id)
    if call is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No screening call found for this candidate")
    return TalentosScreeningResultResponse.model_validate(call)


@router.post("/jobs/{job_id}/candidates/{candidate_id}/trigger-interview", response_model=TalentosInterviewTriggerResponse)
async def trigger_interview(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireSuperAdmin,
    service: TalentosIntegrationService = Depends(_get_service),
):
    try:
        session = await service.trigger_interview(actor, job_id, candidate_id)
        return TalentosInterviewTriggerResponse(interview_session_id=session.id, status="created")
    except DomainError as exc:
        _raise_domain(exc)


@router.get("/jobs/{job_id}/candidates/{candidate_id}/interviews", response_model=List[TalentosInterviewResponse])
async def list_interviews(
    job_id: uuid.UUID,
    candidate_id: uuid.UUID,
    actor: RequireSuperAdmin,
    service: TalentosIntegrationService = Depends(_get_service),
):
    sessions = await service.list_interviews(actor, job_id, candidate_id)
    return [TalentosInterviewResponse.model_validate(s) for s in sessions]
