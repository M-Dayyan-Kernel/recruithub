"""Screening HR query and result orchestration."""

from __future__ import annotations

import asyncio
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.tenancy import get_tenant_job, get_tenant_screening_call
from app.exceptions import ValidationError
from app.models.models import Candidate, User
from app.repositories.interview_repository import InterviewRepository
from app.repositories.screening_repository import LIVE_CALL_STATUSES, ScreeningRepository
from app.schemas.schemas import ScreeningCallResponse, ScreeningResultUpdate
from app.services.audit_service import AuditService

logger = logging.getLogger(__name__)

_VALID_RESULTS = frozenset({"pass", "fail", "needs_review"})


class ScreeningService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        screening_repo: ScreeningRepository | None = None,
        interview_repo: InterviewRepository | None = None,
        audit_service: AuditService | None = None,
    ) -> None:
        self._session = session
        self._screening = screening_repo or ScreeningRepository(session)
        self._interviews = interview_repo or InterviewRepository(session)
        self._audit = audit_service or AuditService(session)

    async def list_results(
        self, actor: User, job_id: uuid.UUID
    ) -> list[ScreeningCallResponse]:
        from app.tasks.screening_tasks import (
            refresh_live_screening_calls_from_vapi,
            sync_screening_call_status,
        )

        await get_tenant_job(self._session, job_id, actor.tenant_id)
        calls = await self._screening.list_for_job(job_id)

        live_ids = [
            str(call.id)
            for call in calls
            if call.call_status in LIVE_CALL_STATUSES and call.vapi_call_id
        ]
        if live_ids:
            try:
                refreshed = await asyncio.wait_for(
                    refresh_live_screening_calls_from_vapi(self._session, calls),
                    timeout=config.vapi.status_timeout_seconds,
                )
            except TimeoutError:
                logger.warning(
                    "Timed out refreshing live screening calls for job %s", job_id
                )
                refreshed = False
                for screening_call_id in live_ids:
                    try:
                        sync_screening_call_status.apply_async(
                            args=[screening_call_id],
                            countdown=0,
                        )
                    except Exception as exc:
                        logger.error(
                            "Failed to enqueue sync for screening_call %s: %s",
                            screening_call_id,
                            exc,
                        )
            else:
                if refreshed:
                    calls = await self._screening.list_for_job(job_id)

        interview_candidate_ids = await self._interviews.candidate_ids_with_sessions(job_id)
        return [
            self._to_response(
                call,
                has_interview_session=call.candidate_id in interview_candidate_ids,
            )
            for call in calls
        ]

    async def refresh_call(
        self, actor: User, screening_id: uuid.UUID
    ) -> ScreeningCallResponse:
        from app.tasks.screening_tasks import refresh_screening_call_from_vapi

        screening_call = await get_tenant_screening_call(
            self._session, screening_id, actor.tenant_id
        )

        if screening_call.call_status in LIVE_CALL_STATUSES and screening_call.vapi_call_id:
            await refresh_screening_call_from_vapi(self._session, screening_call)
            screening_call = await get_tenant_screening_call(
                self._session, screening_id, actor.tenant_id
            )

        interview_candidate_ids = await self._interviews.candidate_ids_with_sessions(
            screening_call.job_id
        )
        return self._to_response(
            screening_call,
            has_interview_session=screening_call.candidate_id in interview_candidate_ids,
        )

    async def update_result(
        self,
        actor: User,
        screening_id: uuid.UUID,
        payload: ScreeningResultUpdate,
    ) -> ScreeningCallResponse:
        if payload.result not in _VALID_RESULTS:
            raise ValidationError(
                public_message=(
                    f"result must be one of: {', '.join(sorted(_VALID_RESULTS))}"
                ),
            )

        screening_call = await get_tenant_screening_call(
            self._session, screening_id, actor.tenant_id
        )

        if screening_call.call_status != "completed":
            raise ValidationError(
                public_message="Screening result can only be set after the call is completed.",
            )

        before_result = screening_call.result
        screening_call.result = payload.result
        if payload.result != "pass":
            screening_call.interview_queued_at = None

        candidate = await self._session.get(Candidate, screening_call.candidate_id)
        subject = (candidate.name if candidate and candidate.name else None) or str(
            screening_call.candidate_id
        )
        await self._audit.log_change(
            actor=actor,
            action="screening.result_set",
            entity_type="screening",
            entity_id=screening_call.id,
            subject_label=subject,
            feature="result",
            before={"result": before_result},
            after={"result": payload.result},
            job_id=screening_call.job_id,
            candidate_id=screening_call.candidate_id,
        )
        await self._session.commit()
        await self._screening.refresh(screening_call)

        interview_candidate_ids = await self._interviews.candidate_ids_with_sessions(
            screening_call.job_id
        )
        return self._to_response(
            screening_call,
            has_interview_session=screening_call.candidate_id in interview_candidate_ids,
        )

    @staticmethod
    def _to_response(
        call, *, has_interview_session: bool = False
    ) -> ScreeningCallResponse:
        response = ScreeningCallResponse.model_validate(call)
        response.has_interview_session = has_interview_session
        return response
