"""Candidate persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models.models import Candidate, InterviewSession, ShortlistResult


class CandidateRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_for_job(self, candidate_id: uuid.UUID, job_id: uuid.UUID) -> Candidate:
        result = await self._session.execute(
            select(Candidate).where(
                Candidate.id == candidate_id,
                Candidate.job_id == job_id,
            )
        )
        candidate = result.scalar_one_or_none()
        if candidate is None:
            raise NotFoundError(public_message="Candidate not found for this job")
        return candidate

    async def find_by_filename(
        self, job_id: uuid.UUID, filename: str
    ) -> Candidate | None:
        result = await self._session.execute(
            select(Candidate).where(
                Candidate.job_id == job_id,
                Candidate.original_filename == filename,
            )
        )
        return result.scalar_one_or_none()

    async def find_duplicate_for_job(
        self,
        job_id: uuid.UUID,
        *,
        exclude_id: uuid.UUID,
        email: str | None,
        phone: str | None,
    ) -> Candidate | None:
        from app.services.candidate_contact_service import normalize_email, normalize_phone

        norm_email = normalize_email(email)
        norm_phone = normalize_phone(phone)
        if not norm_email and not norm_phone:
            return None

        result = await self._session.execute(
            select(Candidate).where(
                Candidate.job_id == job_id,
                Candidate.id != exclude_id,
            )
        )
        for other in result.scalars().all():
            other_email = normalize_email(
                (other.parsed_data or {}).get("email") or other.email
            )
            other_phone = normalize_phone(other.phone)
            if norm_email and other_email == norm_email:
                return other
            if norm_phone and other_phone and other_phone == norm_phone:
                return other
        return None

    def _list_query(
        self,
        job_id: uuid.UUID,
        *,
        pipeline_statuses: list[str] | None = None,
        has_shortlist_result: bool | None = None,
    ):
        stmt = select(Candidate).where(Candidate.job_id == job_id)
        if pipeline_statuses:
            stmt = stmt.where(Candidate.pipeline_status.in_(pipeline_statuses))
        if has_shortlist_result is not None:
            shortlist_exists = (
                select(ShortlistResult.id)
                .where(ShortlistResult.candidate_id == Candidate.id)
                .correlate(Candidate)
            )
            if has_shortlist_result:
                stmt = stmt.where(exists(shortlist_exists))
            else:
                stmt = stmt.where(~exists(shortlist_exists))
        return stmt.order_by(Candidate.created_at.desc())

    async def list_for_job(
        self,
        job_id: uuid.UUID,
        *,
        pipeline_statuses: list[str] | None = None,
        has_shortlist_result: bool | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[Candidate]:
        stmt = self._list_query(
            job_id,
            pipeline_statuses=pipeline_statuses,
            has_shortlist_result=has_shortlist_result,
        )
        result = await self._session.execute(stmt.offset(offset).limit(limit))
        return list(result.scalars().all())

    async def count_for_job(
        self,
        job_id: uuid.UUID,
        *,
        pipeline_statuses: list[str] | None = None,
        has_shortlist_result: bool | None = None,
    ) -> int:
        stmt = self._list_query(
            job_id,
            pipeline_statuses=pipeline_statuses,
            has_shortlist_result=has_shortlist_result,
        )
        count_stmt = select(func.count()).select_from(stmt.subquery())
        return int((await self._session.execute(count_stmt)).scalar() or 0)

    async def list_interview_sessions(self, candidate_id: uuid.UUID) -> list[InterviewSession]:
        result = await self._session.execute(
            select(InterviewSession).where(InterviewSession.candidate_id == candidate_id)
        )
        return list(result.scalars().all())

    async def get_by_id(self, candidate_id: uuid.UUID) -> Candidate | None:
        return await self._session.get(Candidate, candidate_id)

    def add(self, candidate: Candidate) -> Candidate:
        self._session.add(candidate)
        return candidate

    async def delete(self, candidate: Candidate) -> None:
        await self._session.delete(candidate)

    async def flush(self) -> None:
        await self._session.flush()

    async def refresh(self, candidate: Candidate) -> None:
        await self._session.refresh(candidate)
