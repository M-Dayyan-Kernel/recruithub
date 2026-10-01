"""InterviewSession and related persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import InterviewReport, InterviewSession, ScreeningCall


class InterviewRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_session_by_token(self, token: str) -> InterviewSession | None:
        result = await self._session.execute(
            select(InterviewSession).where(InterviewSession.unique_token == token)
        )
        return result.scalar_one_or_none()

    async def get_latest_session_for_candidate(
        self, candidate_id: uuid.UUID
    ) -> InterviewSession | None:
        result = await self._session.execute(
            select(InterviewSession)
            .where(InterviewSession.candidate_id == candidate_id)
            .order_by(InterviewSession.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_for_job(self, job_id: uuid.UUID) -> list[InterviewSession]:
        result = await self._session.execute(
            select(InterviewSession)
            .where(InterviewSession.job_id == job_id)
            .order_by(InterviewSession.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_report_for_candidate(
        self, candidate_id: uuid.UUID
    ) -> InterviewReport | None:
        result = await self._session.execute(
            select(InterviewReport)
            .where(InterviewReport.candidate_id == candidate_id)
            .order_by(InterviewReport.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def candidate_ids_with_sessions(self, job_id: uuid.UUID) -> set[uuid.UUID]:
        result = await self._session.execute(
            select(InterviewSession.candidate_id).where(InterviewSession.job_id == job_id)
        )
        return set(result.scalars().all())

    async def get_latest_pass_screening_call(
        self, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> ScreeningCall | None:
        result = await self._session.execute(
            select(ScreeningCall)
            .where(
                ScreeningCall.candidate_id == candidate_id,
                ScreeningCall.job_id == job_id,
                ScreeningCall.call_status == "completed",
                ScreeningCall.result == "pass",
            )
            .order_by(ScreeningCall.created_at.desc())
            .limit(1)
        )
        return result.scalars().first()

    async def flush(self) -> None:
        await self._session.flush()

    async def refresh(self, session: InterviewSession) -> None:
        await self._session.refresh(session)
