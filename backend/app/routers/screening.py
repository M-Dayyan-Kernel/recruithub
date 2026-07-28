import uuid

from fastapi import APIRouter, Depends, Request, status

from app.dependencies import (
    RequireAdminOrHr,
    get_screening_service,
    get_screening_trigger_service,
    get_screening_webhook_service,
    hr_roles,
)
from app.schemas.schemas import (
    ScreeningCallResponse,
    ScreeningResultUpdate,
    ScreeningTriggerRequest,
    ScreeningTriggerResponse,
)
from app.services.screening_service import ScreeningService
from app.services.screening_trigger_service import ScreeningTriggerService
from app.services.screening_webhook_service import ScreeningWebhookService

router = APIRouter()


@router.post(
    "/jobs/{job_id}/screening/trigger",
    response_model=ScreeningTriggerResponse,
    dependencies=[Depends(hr_roles)],
)
async def trigger_screening(
    job_id: uuid.UUID,
    body: ScreeningTriggerRequest,
    actor: RequireAdminOrHr,
    service: ScreeningTriggerService = Depends(get_screening_trigger_service),
):
    return await service.trigger(actor, job_id, body)


@router.post("/screening/webhook")
async def vapi_webhook(
    request: Request,
    service: ScreeningWebhookService = Depends(get_screening_webhook_service),
):
    service.verify_token(request)
    try:
        body = await request.json()
    except Exception:
        return {"status": "received"}
    return await service.handle_event(body)


@router.get(
    "/jobs/{job_id}/screening",
    response_model=list[ScreeningCallResponse],
    dependencies=[Depends(hr_roles)],
)
async def get_screening_results(
    job_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: ScreeningService = Depends(get_screening_service),
):
    return await service.list_results(actor, job_id)


@router.post(
    "/screening/{screening_id}/refresh",
    response_model=ScreeningCallResponse,
    dependencies=[Depends(hr_roles)],
)
async def refresh_screening_call(
    screening_id: uuid.UUID,
    actor: RequireAdminOrHr,
    service: ScreeningService = Depends(get_screening_service),
):
    return await service.refresh_call(actor, screening_id)


@router.patch(
    "/screening/{screening_id}/result",
    response_model=ScreeningCallResponse,
    dependencies=[Depends(hr_roles)],
)
async def update_screening_result(
    screening_id: uuid.UUID,
    payload: ScreeningResultUpdate,
    actor: RequireAdminOrHr,
    service: ScreeningService = Depends(get_screening_service),
):
    return await service.update_result(actor, screening_id, payload)
