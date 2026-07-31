from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import PLATFORM_TENANT_SLUG
from app.exceptions import NotFoundError, ConflictError
from app.models.models import Candidate, Job, ScreeningCall, ShortlistResult, InterviewSession, Tenant, User
from app.modules.talentos_integration.talentos_be_client import TalentosBEClient
from app.repositories.job_repository import JobRepository

logger = logging.getLogger(__name__)


class TalentosIntegrationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._jobs = JobRepository(session)

    async def resolve_or_create_job(self, external_job_id: str) -> Job:
        result = await self._session.execute(
            select(Job).where(Job.external_job_id == external_job_id).limit(1)
        )
        job = result.scalar_one_or_none()
        if job is not None:
            return job

        client = TalentosBEClient()
        data = await client.get_hiring_request(external_job_id)
        if data is None:
            raise NotFoundError(public_message=f"Job with external id {external_job_id} not found in talentOS")

        tenant_id = await self._get_platform_tenant_id()
        description = (data.get("description") or "")
        parts = []
        if data.get("location"):
            parts.append(f"Location: {data['location']}")
        if data.get("department"):
            parts.append(f"Department: {data['department']}")
        if data.get("employment_type") or data.get("type"):
            parts.append(f"Type: {data.get('employment_type') or data['type']}")
        if parts:
            description = description + "\n\n" + "\n".join(parts)

        job = Job(
            title=data.get("title") or "Untitled",
            description=description,
            required_skills=data.get("requirements"),
            external_job_id=external_job_id,
            tenant_id=tenant_id,
            status="active",
        )
        self._session.add(job)
        await self._session.commit()
        await self._session.refresh(job)
        return job

    async def _get_platform_tenant_id(self) -> uuid.UUID:
        result = await self._session.execute(
            select(Tenant).where(Tenant.slug == PLATFORM_TENANT_SLUG).limit(1)
        )
        tenant = result.scalar_one_or_none()
        if tenant is None:
            raise NotFoundError(public_message="Platform tenant not found")
        return tenant.id

    async def create_job(self, actor: User, payload) -> Job:
        if payload.external_job_id:
            existing = await self._session.execute(
                select(Job).where(Job.external_job_id == payload.external_job_id).limit(1)
            )
            existing_job = existing.scalar_one_or_none()
            if existing_job is not None:
                return existing_job

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
            external_job_id=payload.external_job_id,
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
        candidate = Candidate(
            job_id=job_id,
            name=payload.name,
            email=payload.email,
            phone=payload.phone or None,
            external_candidate_id=payload.external_candidate_id or None,
            pipeline_status="queued",
        )
        self._session.add(candidate)
        await self._session.commit()
        await self._session.refresh(candidate)
        return candidate

    async def create_candidate_with_screening(
        self, actor: User, job_id: uuid.UUID, payload
    ) -> tuple[Candidate, int, int, list[dict]]:
        from app.services.screening_trigger_service import dispatch_screening_for_candidates

        job = await self._session.get(Job, job_id)
        if job is None:
            raise NotFoundError(public_message="Job not found")

        candidate = await self.create_candidate(actor, job_id, payload)

        shortlist = ShortlistResult(
            candidate_id=candidate.id,
            job_id=job_id,
            match_score=0.0,
            recommendation="shortlisted",
            strengths=[],
            gaps=[],
            reason="Auto-approved via talentOS integration",
            hr_decision="approved",
        )
        self._session.add(shortlist)
        await self._session.commit()
        await self._session.refresh(candidate)

        initiated, queued, skipped = await dispatch_screening_for_candidates(
            self._session,
            job,
            [candidate.id],
            force=getattr(payload, "force", False),
        )

        return candidate, initiated, queued, skipped

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
