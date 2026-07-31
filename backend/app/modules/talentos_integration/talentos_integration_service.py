from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import PLATFORM_TENANT_SLUG
from app.core.settings import settings
from app.exceptions import NotFoundError, ConflictError
from app.models.models import Candidate, InterviewSession, Job, ScreeningCall, ShortlistResult, Tenant, User
from app.modules.talentos_integration.talentos_be_client import TalentosBEClient
from app.repositories.job_repository import JobRepository

logger = logging.getLogger(__name__)


def waives_screening_pass(candidate: Candidate) -> bool:
    """talentOS candidates are shortlisted/screened externally.

    The POC's pass-screening gate (a ScreeningCall with result="pass") must be
    skipped for them — the decision was made on the talentOS platform.
    """
    return bool(getattr(candidate, "skip_ai_shortlist", False))


class TalentosIntegrationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._jobs = JobRepository(session)

    async def resolve_or_create_job(self, actor: User, external_job_id: str) -> Job:
        tenant_id = await self._effective_tenant_id(actor)
        result = await self._session.execute(
            select(Job).where(
                Job.external_job_id == external_job_id,
                Job.tenant_id == tenant_id,
            ).limit(1)
        )
        job = result.scalar_one_or_none()
        if job is not None:
            return job

        client = TalentosBEClient()
        data = await client.get_hiring_request(external_job_id)
        if data is None:
            raise NotFoundError(public_message=f"Job with external id {external_job_id} not found in talentOS")

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

    async def _effective_tenant_id(self, actor: User) -> uuid.UUID:
        if actor.tenant_id is not None:
            return actor.tenant_id
        return await self._get_platform_tenant_id()

    async def _require_tenant_job(self, job_id: uuid.UUID, tenant_id: uuid.UUID) -> Job:
        job = await self._session.get(Job, job_id)
        if job is None or job.tenant_id != tenant_id:
            raise NotFoundError(public_message="Job not found")
        return job

    async def create_job(self, actor: User, payload) -> Job:
        tenant_id = await self._effective_tenant_id(actor)
        if payload.external_job_id:
            existing = await self._session.execute(
                select(Job).where(
                    Job.external_job_id == payload.external_job_id,
                    Job.tenant_id == tenant_id,
                ).limit(1)
            )
            existing_job = existing.scalar_one_or_none()
            if existing_job is not None:
                return existing_job

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
        await self._require_tenant_job(job_id, await self._effective_tenant_id(actor))
        candidate = Candidate(
            job_id=job_id,
            name=payload.name,
            email=payload.email,
            phone=payload.phone or None,
            external_candidate_id=payload.external_candidate_id or None,
            pipeline_status="queued",
            skip_ai_shortlist=True,
        )
        self._session.add(candidate)
        await self._session.commit()
        await self._session.refresh(candidate)
        return candidate

    async def create_candidate_with_screening(
        self, actor: User, job_id: uuid.UUID, payload
    ) -> tuple[Candidate, int, int, list[dict], str | None]:
        from app.services.screening_trigger_service import dispatch_screening_for_candidates

        job = await self._require_tenant_job(job_id, await self._effective_tenant_id(actor))

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

        call_result = await self._session.execute(
            select(ScreeningCall)
            .where(ScreeningCall.candidate_id == candidate.id)
            .order_by(ScreeningCall.created_at.desc())
            .limit(1)
        )
        call = call_result.scalars().first()

        return candidate, initiated, queued, skipped, (str(call.id) if call else None)

    async def create_candidate_with_interview(
        self, actor: User, job_id: uuid.UUID, payload
    ) -> tuple[Candidate, InterviewSession]:
        await self._require_tenant_job(job_id, await self._effective_tenant_id(actor))
        candidate = await self.create_candidate(actor, job_id, payload)

        existing = await self._session.execute(
            select(InterviewSession).where(
                InterviewSession.job_id == job_id,
                InterviewSession.candidate_id == candidate.id,
                InterviewSession.status.in_(["pending", "active"]),
            ).limit(1)
        )
        if existing.scalar_one_or_none() and not getattr(payload, "force", False):
            raise ConflictError(public_message="An active interview session already exists for this candidate")

        session = InterviewSession(
            candidate_id=candidate.id,
            job_id=job_id,
            unique_token=str(uuid.uuid4()),
            status="pending",
        )
        self._session.add(session)
        await self._session.commit()
        await self._session.refresh(session)
        return candidate, session

    async def trigger_screening(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> ScreeningCall:
        tenant_id = await self._effective_tenant_id(actor)
        await self._require_tenant_job(job_id, tenant_id)
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
        await self._require_tenant_job(job_id, await self._effective_tenant_id(actor))
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
        await self._require_tenant_job(job_id, await self._effective_tenant_id(actor))
        result = await self._session.execute(
            select(Candidate)
            .where(Candidate.job_id == job_id)
            .order_by(Candidate.created_at.desc())
        )
        return list(result.scalars().all())

    async def trigger_interview(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> InterviewSession:
        tenant_id = await self._effective_tenant_id(actor)
        await self._require_tenant_job(job_id, tenant_id)
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
        await self._require_tenant_job(job_id, await self._effective_tenant_id(actor))
        result = await self._session.execute(
            select(InterviewSession)
            .where(
                InterviewSession.job_id == job_id,
                InterviewSession.candidate_id == candidate_id,
            )
            .order_by(InterviewSession.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_interview_detail(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID, interview_id: uuid.UUID
    ) -> dict | None:
        await self._require_tenant_job(job_id, await self._effective_tenant_id(actor))
        result = await self._session.execute(
            select(InterviewSession)
            .options(selectinload(InterviewSession.report))
            .where(
                InterviewSession.id == interview_id,
                InterviewSession.job_id == job_id,
                InterviewSession.candidate_id == candidate_id,
            )
            .limit(1)
        )
        session = result.scalars().first()
        if session is None:
            return None

        data: dict = {
            "id": session.id,
            "status": session.status,
            "hr_decision": session.hr_decision,
            "interview_url": f"{settings.CANDIDATE_APP_URL}/interview/{session.unique_token}",
            "created_at": session.created_at,
            "started_at": session.started_at,
            "completed_at": session.completed_at,
            "expires_at": session.expires_at,
            "transcript": session.transcript,
        }

        report = session.report
        if report is not None:
            data.update({
                "summary": report.summary,
                "transcript_summary": report.transcript_summary,
                "overall_score": report.overall_score,
                "technical_fit_score": report.technical_fit_score,
                "communication_score": report.communication_score,
                "problem_solving_score": report.problem_solving_score,
                "experience_score": report.experience_score,
                "role_alignment_score": report.role_alignment_score,
                "strengths": report.strengths,
                "weaknesses": report.weaknesses,
                "jd_fit": report.jd_fit,
                "final_recommendation": report.final_recommendation,
            })
        return data
