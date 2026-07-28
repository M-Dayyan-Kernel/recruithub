"""Candidate CRUD and pipeline retry orchestration."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_actor_label, log_event
from app.core.pagination import PaginationParams
from app.core.tenancy import get_tenant_candidate, get_tenant_job
from app.exceptions import CandidateNotFoundForJobError, CandidateNotRetryableError
from app.models.models import Candidate, User
from app.repositories.candidate_repository import CandidateRepository
from app.schemas.schemas import (
    CandidateDetailResponse,
    CandidateResponse,
    CandidateUpdate,
    PaginatedResponse,
)
from app.services.audit_service import AuditService
from app.services.processing_queue_service import ProcessingQueueService
from app.services.resume_storage_service import ResumeStorageService
from app.services.retention_service import erase_candidate_pii

logger = logging.getLogger(__name__)

_RETRYABLE_STATUSES = ("failed", "completed", "queued", "processing")


class CandidateService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        candidate_repo: CandidateRepository | None = None,
        audit_service: AuditService | None = None,
        storage: ResumeStorageService | None = None,
        queue_service: ProcessingQueueService | None = None,
    ) -> None:
        self._session = session
        self._candidates = candidate_repo or CandidateRepository(session)
        self._audit = audit_service or AuditService(session)
        self._storage = storage or ResumeStorageService()
        self._queue = queue_service or ProcessingQueueService(session)

    async def list(
        self,
        actor: User,
        job_id: uuid.UUID,
        *,
        pipeline_status: str | None = None,
        parse_status: str | None = None,
        has_shortlist_result: bool | None = None,
        pagination: PaginationParams,
    ) -> PaginatedResponse:
        await get_tenant_job(self._session, job_id, actor.tenant_id)

        status_filter = pipeline_status or parse_status
        pipeline_statuses = None
        if status_filter:
            pipeline_statuses = [
                s.strip() for s in status_filter.split(",") if s.strip()
            ] or None

        total = await self._candidates.count_for_job(
            job_id,
            pipeline_statuses=pipeline_statuses,
            has_shortlist_result=has_shortlist_result,
        )
        items = await self._candidates.list_for_job(
            job_id,
            pipeline_statuses=pipeline_statuses,
            has_shortlist_result=has_shortlist_result,
            offset=pagination.offset,
            limit=pagination.limit,
        )
        return PaginatedResponse(
            items=[CandidateResponse.model_validate(c) for c in items],
            total=total,
            limit=pagination.limit,
            offset=pagination.offset,
        )

    async def get(self, actor: User, candidate_id: uuid.UUID) -> CandidateDetailResponse:
        candidate = await get_tenant_candidate(
            self._session, candidate_id, actor.tenant_id
        )
        await self._audit.log_change(
            actor=actor,
            action="candidate.view_detail",
            entity_type="candidate",
            entity_id=candidate.id,
            subject_label=candidate.original_filename or candidate.name or str(candidate_id),
            feature="pii_access",
            job_id=candidate.job_id,
            candidate_id=candidate.id,
        )
        await self._session.commit()
        return CandidateDetailResponse.model_validate(candidate)

    async def update(
        self,
        actor: User,
        candidate_id: uuid.UUID,
        payload: CandidateUpdate,
    ) -> CandidateResponse:
        candidate = await get_tenant_candidate(
            self._session, candidate_id, actor.tenant_id
        )
        changes: dict[str, tuple[object, object]] = {}
        if payload.phone is not None:
            changes["phone"] = (candidate.phone, payload.phone)
            candidate.phone = payload.phone
        if payload.name is not None:
            changes["name"] = (candidate.name, payload.name)
            candidate.name = payload.name
        if payload.email is not None:
            changes["email"] = (candidate.email, payload.email)
            candidate.email = payload.email

        await self._audit.log_field_changes(
            actor=actor,
            action="candidate.updated",
            entity_type="candidate",
            entity_id=candidate.id,
            subject_label=candidate.original_filename or candidate.name or str(candidate_id),
            changes=changes,
            job_id=candidate.job_id,
            candidate_id=candidate.id,
        )
        await self._session.commit()
        await self._candidates.refresh(candidate)
        return CandidateResponse.model_validate(candidate)

    async def delete(self, actor: User, candidate_id: uuid.UUID) -> None:
        candidate = await get_tenant_candidate(
            self._session, candidate_id, actor.tenant_id
        )
        sessions = await self._candidates.list_interview_sessions(candidate.id)
        recording_keys = [s.recording_key for s in sessions if s.recording_key]

        job_id = candidate.job_id
        was_active = candidate.pipeline_status in ("queued", "processing")
        label = candidate.original_filename or candidate.name or str(candidate_id)
        resume_path = candidate.resume_file_path

        await self._audit.log_change(
            actor=actor,
            action="candidate.deleted",
            entity_type="candidate",
            entity_id=candidate.id,
            subject_label=label,
            feature="candidate",
            before={
                "name": candidate.name,
                "email": candidate.email,
                "original_filename": candidate.original_filename,
                "recording_keys": recording_keys,
            },
            after=None,
            job_id=job_id,
            candidate_id=candidate.id,
        )
        await self._candidates.delete(candidate)
        await self._session.commit()

        await self._storage.delete_resume(resume_path)
        await self._storage.delete_recordings(recording_keys)

        if was_active:
            await self._queue.dispatch_slots(job_id)

    async def retry_processing(
        self,
        actor: User,
        job_id: uuid.UUID,
        candidate_id: uuid.UUID,
    ) -> dict[str, str]:
        await get_tenant_job(self._session, job_id, actor.tenant_id)
        candidate = await get_tenant_candidate(
            self._session, candidate_id, actor.tenant_id
        )
        if candidate.job_id != job_id:
            raise CandidateNotFoundForJobError()
        if candidate.pipeline_status not in _RETRYABLE_STATUSES:
            raise CandidateNotRetryableError()

        before_status = candidate.pipeline_status
        candidate.pipeline_status = "queued"
        candidate.processing_started_at = None
        await self._audit.log_change(
            actor=actor,
            action="candidate.retry_processing",
            entity_type="candidate",
            entity_id=candidate.id,
            subject_label=candidate.original_filename or candidate.name or str(candidate_id),
            feature="pipeline_status",
            before={"pipeline_status": before_status},
            after={"pipeline_status": "queued"},
            job_id=job_id,
            candidate_id=candidate.id,
        )
        await self._session.commit()
        await self._queue.dispatch_slots(job_id)
        log_event(
            logger,
            "%s re-queued AI processing for %s",
            get_actor_label(),
            candidate.original_filename or candidate.name or "a candidate",
        )
        return {"status": "queued", "candidate_id": str(candidate_id)}

    async def gdpr_erase(self, actor: User, candidate_id: uuid.UUID) -> None:
        candidate = await get_tenant_candidate(
            self._session, candidate_id, actor.tenant_id
        )
        await erase_candidate_pii(
            self._session, candidate, tenant_id=actor.tenant_id
        )
        await self._audit.log_change(
            actor=actor,
            action="candidate.gdpr_erase",
            entity_type="candidate",
            entity_id=candidate.id,
            subject_label=str(candidate_id),
            feature="gdpr",
            job_id=candidate.job_id,
            candidate_id=candidate.id,
        )
        await self._session.commit()
