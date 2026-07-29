from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import PLATFORM_TENANT_SLUG
from app.exceptions import NotFoundError, ConflictError
from app.models.models import Candidate, Job, ScreeningCall, InterviewSession, Tenant, User
from app.repositories.job_repository import JobRepository

logger = logging.getLogger(__name__)


class TalentosIntegrationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._jobs = JobRepository(session)

    async def _get_platform_tenant_id(self) -> uuid.UUID:
        result = await self._session.execute(
            select(Tenant).where(Tenant.slug == PLATFORM_TENANT_SLUG).limit(1)
        )
        tenant = result.scalar_one_or_none()
        if tenant is None:
            raise NotFoundError(public_message="Platform tenant not found")
        return tenant.id

    async def create_job(self, actor: User, payload) -> Job:
        tenant_id = await self._get_platform_tenant_id()

        description = payload.description
        parts = []
        if payload.location:
            parts.append(f"Location: {payload.location}")
        if payload.department:
            parts.append(f"Department: {payload.department}")
        if payload.employment_type:
            parts.append(f"Type: {payload.employment_type}")
        if parts:
            description = description + "\n\n" + "\n".join(parts)

        job = Job(
            title=payload.title,
            description=description,
            required_skills=payload.required_skills,
            tenant_id=tenant_id,
            status="active",
        )
        self._jobs.add(job)
        await self._jobs.flush()
        await self._session.commit()
        await self._jobs.refresh(job)
        return job

    async def create_candidate(
        self, actor: User, job_id: uuid.UUID, payload
    ) -> Candidate:
        existing = await self._session.execute(
            select(Candidate).where(
                Candidate.job_id == job_id,
                Candidate.email == payload.email,
            ).limit(1)
        )
        if existing.scalar_one_or_none():
            raise ConflictError(
                public_message=f"Candidate with email {payload.email} already exists in this job"
            )

        candidate = Candidate(
            job_id=job_id,
            name=payload.name,
            email=payload.email,
            phone=payload.phone or None,
            pipeline_status="queued",
        )
        self._session.add(candidate)
        await self._session.commit()
        await self._session.refresh(candidate)
        return candidate

    async def trigger_screening(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> ScreeningCall:
        candidate = await self._session.get(Candidate, candidate_id)
        if candidate is None or candidate.job_id != job_id:
            raise NotFoundError(public_message="Candidate not found in this job")

        existing = await self._session.execute(
            select(ScreeningCall).where(
                ScreeningCall.job_id == job_id,
                ScreeningCall.candidate_id == candidate_id,
            ).limit(1)
        )
        if existing.scalar_one_or_none():
            raise ConflictError(public_message="Screening already triggered for this candidate")

        screening_call = ScreeningCall(
            candidate_id=candidate_id,
            job_id=job_id,
            call_status="completed",
            result="pass",
            summary="Screening bypassed — candidate moved via talentOS integration",
            call_outcome="completed",
        )
        self._session.add(screening_call)
        await self._session.commit()
        await self._session.refresh(screening_call)
        return screening_call

    async def get_screening_result(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> ScreeningCall | None:
        result = await self._session.execute(
            select(ScreeningCall)
            .where(
                ScreeningCall.job_id == job_id,
                ScreeningCall.candidate_id == candidate_id,
            )
            .order_by(ScreeningCall.created_at.desc())
            .limit(1)
        )
        return result.scalars().first()

    async def list_candidates(
        self, actor: User, job_id: uuid.UUID
    ) -> list[Candidate]:
        result = await self._session.execute(
            select(Candidate)
            .where(Candidate.job_id == job_id)
            .order_by(Candidate.created_at.desc())
        )
        return list(result.scalars().all())

    async def trigger_interview(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> InterviewSession:
        candidate = await self._session.get(Candidate, candidate_id)
        if candidate is None or candidate.job_id != job_id:
            raise NotFoundError(public_message="Candidate not found in this job")

        existing = await self._session.execute(
            select(InterviewSession).where(
                InterviewSession.job_id == job_id,
                InterviewSession.candidate_id == candidate_id,
                InterviewSession.status.in_(["pending", "active"]),
            ).limit(1)
        )
        if existing.scalar_one_or_none():
            raise ConflictError(public_message="An active interview session already exists for this candidate")

        session = InterviewSession(
            candidate_id=candidate_id,
            job_id=job_id,
            unique_token=str(uuid.uuid4()),
            status="pending",
        )
        self._session.add(session)
        await self._session.commit()
        await self._session.refresh(session)
        return session

    async def list_interviews(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> list[InterviewSession]:
        result = await self._session.execute(
            select(InterviewSession)
            .where(
                InterviewSession.job_id == job_id,
                InterviewSession.candidate_id == candidate_id,
            )
            .order_by(InterviewSession.created_at.desc())
        )
        return list(result.scalars().all())
