"""Tenant-wide candidate directory — list and profile aggregation."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import PaginationParams
from app.exceptions import NotFoundError
from app.models.models import InterviewSession, User
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.candidate_directory_repository import (
    CandidateDirectoryRepository,
    CandidateDirectoryRow,
)
from app.schemas.schemas import (
    AuditLogResponse,
    CandidateListItem,
    CandidateProfileResponse,
    PaginatedResponse,
    ScreeningCallResponse,
    ShortlistResultResponse,
    InterviewSessionResponse,
)
from app.services.candidate_stage_filter import (
    CandidateStageFilter,
    stage_filter_label,
)
from app.services.hiring_stage_resolver import resolve_hiring_stage


class CandidateDirectoryService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        directory_repo: CandidateDirectoryRepository | None = None,
        audit_repo: AuditLogRepository | None = None,
    ) -> None:
        self._session = session
        self._directory = directory_repo or CandidateDirectoryRepository(session)
        self._audit = audit_repo or AuditLogRepository(session)

    async def list(
        self,
        actor: User,
        *,
        job_id: uuid.UUID | None = None,
        q: str | None = None,
        stage: CandidateStageFilter | None = None,
        pagination: PaginationParams,
    ) -> PaginatedResponse:
        if stage is not None:
            return await self._list_with_stage_filter(
                actor,
                job_id=job_id,
                q=q,
                stage=stage,
                pagination=pagination,
            )

        rows = await self._directory.list_for_tenant(
            actor.tenant_id,
            job_id=job_id,
            q=q,
            offset=pagination.offset,
            limit=pagination.limit,
        )
        total = await self._directory.count_for_tenant(
            actor.tenant_id,
            job_id=job_id,
            q=q,
        )
        items = []
        for candidate, job_title in rows:
            profile_row = await self._directory.get_profile_row(actor.tenant_id, candidate.id)
            if profile_row is None:
                continue
            items.append(self._build_list_item(profile_row, job_title))
        return PaginatedResponse(
            items=items,
            total=total,
            limit=pagination.limit,
            offset=pagination.offset,
        )

    async def _list_with_stage_filter(
        self,
        actor: User,
        *,
        job_id: uuid.UUID | None,
        q: str | None,
        stage: CandidateStageFilter,
        pagination: PaginationParams,
    ) -> PaginatedResponse:
        target_label = stage_filter_label(stage)
        rows = await self._directory.list_all_for_tenant(
            actor.tenant_id,
            job_id=job_id,
            q=q,
        )
        items: list[CandidateListItem] = []
        for candidate, job_title in rows:
            profile_row = await self._directory.get_profile_row(actor.tenant_id, candidate.id)
            if profile_row is None:
                continue
            item = self._build_list_item(profile_row, job_title)
            if item.hiring_stage == target_label:
                items.append(item)
        total = len(items)
        page_items = items[pagination.offset : pagination.offset + pagination.limit]
        return PaginatedResponse(
            items=page_items,
            total=total,
            limit=pagination.limit,
            offset=pagination.offset,
        )

    async def get_profile(
        self, actor: User, candidate_id: uuid.UUID
    ) -> CandidateProfileResponse:
        row = await self._directory.get_profile_row(actor.tenant_id, candidate_id)
        if row is None:
            raise NotFoundError(public_message="Candidate not found")

        sessions_result = await self._session.execute(
            select(InterviewSession)
            .where(InterviewSession.candidate_id == candidate_id)
            .order_by(InterviewSession.created_at.desc())
        )
        sessions = [
            InterviewSessionResponse.model_validate(s)
            for s in sessions_result.scalars().all()
        ]

        timeline_filters = AuditLogRepository.build_filters(
            tenant_id=actor.tenant_id,
            candidate_id=candidate_id,
        )
        audit_rows = await self._audit.list_filtered(
            timeline_filters,
            limit=50,
            offset=0,
        )
        timeline = [AuditLogResponse.model_validate(r) for r in audit_rows]

        base = self._build_list_item(row, row.job_title)
        screening = row.screening
        screening_response = None
        if screening is not None:
            screening_response = ScreeningCallResponse.model_validate(screening)
            screening_response.has_interview_session = row.interview_session is not None

        return CandidateProfileResponse(
            **base.model_dump(),
            parsed_data=row.candidate.parsed_data,
            resume_file_path=row.candidate.resume_file_path,
            shortlist=(
                ShortlistResultResponse.model_validate(row.shortlist)
                if row.shortlist
                else None
            ),
            screening=screening_response,
            interview_sessions=sessions,
            timeline=timeline,
        )

    def _build_list_item(
        self, row: CandidateDirectoryRow, job_title: str
    ) -> CandidateListItem:
        candidate = row.candidate
        hiring_stage = resolve_hiring_stage(
            candidate,
            shortlist=row.shortlist,
            screening=row.screening,
            interview_session=row.interview_session,
            interview_report=row.interview_report,
        )
        match_score = row.shortlist.match_score if row.shortlist else None
        return CandidateListItem(
            id=candidate.id,
            job_id=candidate.job_id,
            job_title=job_title,
            name=candidate.name,
            email=candidate.email,
            phone=candidate.phone,
            years_experience=candidate.years_experience,
            current_ctc=candidate.current_ctc,
            expected_ctc=candidate.expected_ctc,
            notice_period=candidate.notice_period,
            last_working_day=candidate.last_working_day,
            hiring_stage=hiring_stage,
            match_score=match_score,
            status=candidate.status,
            date_applied=candidate.created_at,
            pipeline_status=candidate.pipeline_status,
        )
