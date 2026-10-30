"""Job CRUD and configuration orchestration."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AuthorizationError, ConflictError, ValidationError
from app.models.models import Job, User
from app.repositories.job_repository import JobRepository
from app.schemas.schemas import JobCreate, JobUpdate, validate_experience_range
from app.services.audit_service import AuditService
from app.services.expected_answer_service import ExpectedAnswerService
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
    "experience_min",
    "experience_max",
    "work_mode",
    "work_location",
    "screening_questions",
    "interview_questions",
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

        # The columns are NOT NULL and 0 means "no bound": an explicit null from
        # a client clearing the field is stored as 0, never written as NULL.
        for field in ("experience_min", "experience_max"):
            if field in updates and updates[field] is None:
                updates[field] = 0
        if "experience_min" in updates or "experience_max" in updates:
            # Compare against the stored bound the request leaves untouched, so
            # lowering only the max below the existing min is still caught.
            effective_min = updates.get("experience_min", job.experience_min)
            effective_max = updates.get("experience_max", job.experience_max)
            try:
                validate_experience_range(effective_min, effective_max)
            except ValueError as exc:
                raise ValidationError(public_message=str(exc)) from exc
        self._apply_work_and_screening_updates(job, updates)
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
