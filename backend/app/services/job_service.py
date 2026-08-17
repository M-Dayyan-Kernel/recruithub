"""Job CRUD and configuration orchestration."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ValidationError
from app.models.models import Job, User
from app.repositories.job_repository import JobRepository
from app.schemas.schemas import JobCreate, JobUpdate, validate_experience_range
from app.services.audit_service import AuditService
from app.services.expected_answer_service import ExpectedAnswerService
from app.services.screening_defaults import get_default_screening_questions
from app.services.tenant_integrations_service import TenantIntegrationsService

_NO_SCREENING_QUESTIONS_MESSAGE = (
    "Add at least one screening question, or turn voice screening off."
)

_JOB_AUDIT_FIELDS = (
    "title",
    "description",
    "required_skills",
    "experience_min",
    "experience_max",
    "screening_questions",
    "interview_questions",
    "screening_call_from",
    "screening_call_to",
    "screening_timezone",
    "voice_screening_enabled",
    "status",
)


class JobService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        job_repo: JobRepository | None = None,
        audit_service: AuditService | None = None,
        expected_answers: ExpectedAnswerService | None = None,
        integrations_service: TenantIntegrationsService | None = None,
    ) -> None:
        self._session = session
        self._jobs = job_repo or JobRepository(session)
        self._audit = audit_service or AuditService(session)
        self._expected_answers = expected_answers or ExpectedAnswerService()
        self._integrations = integrations_service or TenantIntegrationsService(session)

    async def create(self, actor: User, payload: JobCreate) -> Job:
        data = payload.model_dump()
        if data.get("screening_questions") is None:
            # Field omitted entirely (JD parsing, API clients): seed the defaults.
            data["screening_questions"] = get_default_screening_questions(
                data.get("title") or ""
            )
        elif not data["screening_questions"] and data.get("voice_screening_enabled"):
            # Explicitly cleared. Refilling here would resurrect questions the
            # user just deleted, so reject instead of silently overriding them.
            raise ValidationError(public_message=_NO_SCREENING_QUESTIONS_MESSAGE)
        if data.get("interview_questions"):
            data["interview_questions"] = await self._enrich_interview_questions(
                actor.tenant_id,
                data["interview_questions"],
                existing=None,
                context_job=Job(
                    title=data["title"],
                    description=data["description"],
                    required_skills=data.get("required_skills"),
                    experience_min=data.get("experience_min", 0),
                    experience_max=data.get("experience_max", 0),
                ),
            )
        job = Job(**data, tenant_id=actor.tenant_id)
        self._jobs.add(job)
        await self._jobs.flush()
        await self._audit.log_change(
            actor=actor,
            action="job.created",
            entity_type="job",
            entity_id=job.id,
            subject_label=job.title,
            feature="job",
            before=None,
            after={"title": job.title, "status": job.status},
            job_id=job.id,
        )
        await self._session.commit()
        await self._jobs.refresh(job)
        return job

    async def list(self, actor: User, status: str | None = None) -> list[Job]:
        return await self._jobs.list_for_tenant(actor.tenant_id, status=status)

    async def get(self, actor: User, job_id: uuid.UUID) -> Job:
        return await self._jobs.get_for_tenant(job_id, actor.tenant_id)

    async def update(self, actor: User, job_id: uuid.UUID, payload: JobUpdate) -> Job:
        job = await self._jobs.get_for_tenant(job_id, actor.tenant_id)
        updates = payload.model_dump(exclude_unset=True)
        if "experience_min" in updates or "experience_max" in updates:
            # Compare against the stored bound the request leaves untouched, so
            # lowering only the max below the existing min is still caught.
            effective_min = updates.get("experience_min", job.experience_min)
            effective_max = updates.get("experience_max", job.experience_max)
            try:
                validate_experience_range(effective_min, effective_max)
            except ValueError as exc:
                raise ValidationError(public_message=str(exc)) from exc
        if "screening_questions" in updates and not updates["screening_questions"]:
            # Voice screening needs something to ask, whether the flag is being
            # changed in this same request or was already on.
            voice_on = updates.get(
                "voice_screening_enabled", job.voice_screening_enabled
            )
            if voice_on:
                raise ValidationError(public_message=_NO_SCREENING_QUESTIONS_MESSAGE)
        if "interview_questions" in updates and updates["interview_questions"] is not None:
            updates["interview_questions"] = await self._enrich_interview_questions(
                actor.tenant_id,
                updates["interview_questions"],
                existing=job.interview_questions,
                context_job=job,
            )

        changes = {}
        for field in _JOB_AUDIT_FIELDS:
            if field not in updates:
                continue
            before_val = _serialize_job_field(getattr(job, field))
            after_val = _serialize_job_field(updates[field])
            changes[field] = (before_val, after_val)

        for field, value in updates.items():
            setattr(job, field, value)

        await self._audit.log_field_changes(
            actor=actor,
            action="job.updated",
            entity_type="job",
            entity_id=job.id,
            subject_label=job.title,
            changes=changes,
            job_id=job.id,
        )
        await self._session.commit()
        await self._jobs.refresh(job)
        return job

    async def delete(self, actor: User, job_id: uuid.UUID) -> None:
        job = await self._jobs.get_for_tenant(job_id, actor.tenant_id)
        title = job.title
        status_before = job.status
        await self._audit.log_change(
            actor=actor,
            action="job.deleted",
            entity_type="job",
            entity_id=job.id,
            subject_label=title,
            feature="job",
            before={"title": title, "status": status_before},
            after=None,
            job_id=job.id,
        )
        await self._jobs.delete(job)
        await self._session.commit()

    async def _enrich_interview_questions(
        self,
        tenant_id: uuid.UUID,
        incoming: list[dict],
        *,
        existing: list | None,
        context_job: Job,
    ) -> list[dict]:
        integrations = await self._integrations.load(tenant_id)
        integrations.require("openai_api_key")
        return await self._expected_answers.enrich(
            incoming,
            existing,
            context_job,
            integrations.openai_api_key,
        )


def _serialize_job_field(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
