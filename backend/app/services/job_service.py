"""Job CRUD and configuration orchestration."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AuthorizationError, ConflictError, ValidationError
from app.models.models import Job, User
from app.repositories.job_repository import JobRepository
from app.schemas.schemas import (
    InterviewTopicRegenerateRequest,
    InterviewTopicRegenerateResponse,
    InterviewTopicsRequest,
    InterviewTopicsResponse,
    JobCreate,
    JobUpdate,
)
from app.services.audit_service import AuditService
from app.services.expected_answer_service import ExpectedAnswerService
from app.services.interview_topic_service import generate_pool, regenerate_topic, replace_topics
from app.services.live_work_guard import assert_job_not_live
from app.services.screening_defaults import (
    normalize_screening_questions_for_write,
    validate_work_location,
)
from app.services.integrity_service import IntegrityService
from app.services.tenant_integrations_service import TenantIntegrationsService

_JOB_AUDIT_FIELDS = (
    "title",
    "description",
    "required_skills",
    "seniority_level",
    "work_mode",
    "work_location",
    "screening_questions",
    "screening_call_from",
    "screening_call_to",
    "screening_timezone",
    "voice_screening_enabled",
    "extension_check_enabled",
    "extension_check_mode",
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
        integrity_service: IntegrityService | None = None,
    ) -> None:
        self._session = session
        self._jobs = job_repo or JobRepository(session)
        self._audit = audit_service or AuditService(session)
        self._expected_answers = expected_answers or ExpectedAnswerService()
        self._integrations = integrations_service or TenantIntegrationsService(session)
        self._integrity = integrity_service or IntegrityService(session)

    async def _require_extension_check_editable(self, actor: User) -> None:
        """A job's extension-check switch and mode can only be changed while the organization's
        master switch is on. The app greys the controls out; this is the server's side of it."""
        if not await self._integrity.org_enabled(actor.tenant_id):
            raise AuthorizationError(
                public_message=(
                    "The AI extension check is turned off for your organization. "
                    "An Admin has to turn it on before it can be changed for a job."
                )
            )

    async def create(self, actor: User, payload: JobCreate) -> Job:
        data = payload.model_dump()
        # The starting values (on, shadow) are what the greyed-out form sends while the
        # organization's switch is off, so only a different choice needs the lookup.
        if (data["extension_check_enabled"], data["extension_check_mode"]) != (True, "shadow"):
            await self._require_extension_check_editable(actor)
        # The list is always the locked standard questions plus whatever role and custom ones
        # were sent; a client's own copies of the standard ones are ignored.
        try:
            data["screening_questions"] = normalize_screening_questions_for_write(
                data.get("screening_questions"),
                title=data["title"],
                work_mode=data["work_mode"],
                work_location=data.get("work_location"),
            )
        except ValueError as exc:
            raise ValidationError(public_message=str(exc)) from exc
        topics = data.pop("interview_topics")
        # An empty pool, set here: a new job's collection would otherwise be lazy-loaded on first
        # read, which the async session cannot do.
        job = Job(**data, tenant_id=actor.tenant_id, interview_topics=[])
        self._jobs.add(job)
        await self._jobs.flush()
        if topics:
            await self._save_topics(actor.tenant_id, job, topics)
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
        if any(
            field in updates and updates[field] != getattr(job, field)
            for field in ("extension_check_enabled", "extension_check_mode")
        ):
            await self._require_extension_check_editable(actor)
        if updates.get("voice_screening_enabled") is False and job.voice_screening_enabled:
            # Turning screening off decides where the phone round goes, under a lock on the
            # job; that lives on POST /jobs/{id}/voice-screening. A plain edit doing it too
            # would be a second, unlocked way to strand candidates waiting for a call.
            raise ConflictError(
                public_message=(
                    "Turn voice screening off with its switch, which asks where candidates "
                    "waiting for a call should go."
                )
            )

        if "seniority_level" in updates and updates["seniority_level"] is None:
            raise ValidationError(public_message="Seniority level cannot be cleared.")

        self._apply_work_and_screening_updates(job, updates)
        topics = updates.pop("interview_topics", None)

        changes = {}
        for field in _JOB_AUDIT_FIELDS:
            if field not in updates:
                continue
            before_val = _serialize_job_field(getattr(job, field))
            after_val = _serialize_job_field(updates[field])
            changes[field] = (before_val, after_val)

        for field, value in updates.items():
            setattr(job, field, value)

        if topics is not None:
            # After the other fields, so a new answer key is written against the job as it will be.
            before_topics = _topic_signature(job.interview_topics)
            await self._save_topics(actor.tenant_id, job, topics)
            if _topic_signature(job.interview_topics) != before_topics:
                changes["interview_topics"] = (
                    [name for name, *_ in before_topics],
                    [t.name for t in job.interview_topics],
                )

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

    @staticmethod
    def _apply_work_and_screening_updates(job: Job, updates: dict) -> None:
        """Validate the work fields against the mode the job will have, and rebuild its question
        list when anything it is built from changes.

        A status-only update (archive, unarchive) touches none of them, so a legacy job with no
        work mode can still be archived.
        """
        if "work_mode" in updates and updates["work_mode"] is None:
            raise ValidationError(
                public_message="Work mode cannot be cleared. Choose remote, hybrid or on-site."
            )
        work_mode = updates.get("work_mode", job.work_mode)
        work_location = updates["work_location"] if "work_location" in updates else job.work_location
        if "work_mode" in updates or "work_location" in updates:
            try:
                updates["work_location"] = validate_work_location(work_mode, work_location)
            except ValueError as exc:
                raise ValidationError(public_message=str(exc)) from exc
            work_location = updates["work_location"]

        if not {"screening_questions", "title", "work_mode", "work_location"} & updates.keys():
            return
        sent = "screening_questions" in updates
        try:
            updates["screening_questions"] = normalize_screening_questions_for_write(
                updates["screening_questions"] if sent else job.screening_questions,
                title=updates.get("title", job.title),
                work_mode=work_mode,
                work_location=work_location,
                # What a client sends must meet the limits; what is already stored may predate
                # them, and renaming a job must not fail on it.
                strict=sent,
            )
        except ValueError as exc:
            raise ValidationError(public_message=str(exc)) from exc

    async def delete(self, actor: User, job_id: uuid.UUID) -> None:
        job = await self._jobs.get_for_tenant(job_id, actor.tenant_id)
        await assert_job_not_live(self._session, job.id)
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

    async def _openai_key(self, tenant_id: uuid.UUID) -> str:
        integrations = await self._integrations.load(tenant_id)
        integrations.require("openai_api_key")
        return integrations.openai_api_key

    async def generate_topics(self, actor: User, request: InterviewTopicsRequest) -> InterviewTopicsResponse:
        """A fresh topic pool for a job that may not be saved yet. Nothing is stored."""
        topics = await generate_pool(
            title=request.title,
            description=request.description,
            required_skills=request.required_skills,
            seniority_level=request.seniority_level.value,
            api_key=await self._openai_key(actor.tenant_id),
        )
        return InterviewTopicsResponse(topics=topics)

    async def regenerate_topic(
        self, actor: User, request: InterviewTopicRegenerateRequest
    ) -> InterviewTopicRegenerateResponse:
        """A replacement for one topic of the pool being edited. Nothing is stored."""
        topic = await regenerate_topic(
            title=request.title,
            description=request.description,
            required_skills=request.required_skills,
            seniority_level=request.seniority_level.value,
            pool=[t.model_dump() for t in request.topics],
            index=request.topic_index,
            api_key=await self._openai_key(actor.tenant_id),
        )
        return InterviewTopicRegenerateResponse(topic=topic)

    async def _save_topics(self, tenant_id: uuid.UUID, job: Job, topics: list[dict]) -> None:
        """Make the job's topic pool `topics`, writing answer keys for new and reworded ones."""
        api_key = await self._openai_key(tenant_id) if topics else None
        await replace_topics(
            self._session,
            job,
            topics,
            generate_points=self._expected_answers.generate,
            api_key=api_key,
        )


def _topic_signature(topics) -> list[tuple]:
    """What makes two pools the same, for deciding whether an edit changed anything."""
    return [(t.name, t.scope, t.skill_tag, t.seed_question, bool(t.is_mandatory)) for t in topics]


def _serialize_job_field(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
