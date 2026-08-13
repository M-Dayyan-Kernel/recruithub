from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config_loader import config
from app.core.constants import PLATFORM_TENANT_SLUG
from app.core.settings import settings
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.models.models import Candidate, InterviewSession, Job, ScreeningCall, ShortlistResult, Tenant, User
from app.modules.talentos_integration.screening_classifier import classify_for_candidate
from app.modules.talentos_integration.talentos_be_client import (
    get_talentos_client_for_tenant,
)
from app.repositories.job_repository import JobRepository
from app.services.screening_defaults import get_default_screening_questions
from app.services.settings_service import load_system_settings

logger = logging.getLogger(__name__)


def waives_screening_pass(candidate: Candidate) -> bool:
    """Backwards-compatible wrapper around Candidate.waives_screening_pass."""
    return candidate.waives_screening_pass


TERMINAL_CALL_STATUSES = frozenset({"completed", "failed"})
SCREENING_FAILURE_OUTCOMES = frozenset(
    {"no_answer", "voicemail", "declined", "dropped", "failed"}
)

DUMMY_JOB_UUID = "00000000-0000-0000-0000-000000000000"

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def _parse_scheduled_slot(scheduled_date: str, scheduled_time: str, timezone_name: str) -> datetime:
    """Parse an HR-selected slot into an aware UTC datetime.

    Kept local to the talentOS integration module — intentionally does not
    import from the POC's own interview scheduling services.
    """
    if not scheduled_date or not _DATE_RE.match(scheduled_date):
        raise ValueError("scheduled_date must be YYYY-MM-DD")
    if not scheduled_time or not _TIME_RE.match(scheduled_time):
        raise ValueError("scheduled_time must be HH:MM")

    try:
        tz = ZoneInfo(timezone_name or "Asia/Kolkata")
    except Exception as exc:
        raise ValueError(f"Invalid timezone: {timezone_name}") from exc

    try:
        naive = datetime.strptime(
            f"{scheduled_date} {scheduled_time}",
            "%Y-%m-%d %H:%M",
        )
    except ValueError as exc:
        raise ValueError("Invalid scheduled date or time") from exc

    return naive.replace(tzinfo=tz).astimezone(timezone.utc)


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

        client = await get_talentos_client_for_tenant(tenant_id)
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
            screening_questions=get_default_screening_questions(data.get("title") or ""),
            external_job_id=external_job_id,
            tenant_id=tenant_id,
            status="active",
        )
        self._session.add(job)
        await self._session.commit()
        await self._session.refresh(job)
        return job

    async def ensure_job(
        self, actor: User, job_id: uuid.UUID, external_job_id: str | None = None
    ) -> Job:
        """Return the job for a talentOS-triggered operation, creating it if needed.

        Resolution order:
        1. Lookup by ``external_job_id`` (talentOS hiring-request id) + tenant.
        2. Lookup by ``job_id`` (POC job uuid) + tenant — skipped when ``job_id``
           is the placeholder ``00000000-...`` the caller uses when the job may
           not exist yet.
        3. When only an ``external_job_id`` is known, create the job by pulling
           its data back from talentOS (``resolve_or_create_job``).

        Raises NotFoundError when neither id resolves and no creation path exists.
        """
        tenant_id = await self._effective_tenant_id(actor)
        if external_job_id:
            result = await self._session.execute(
                select(Job).where(
                    Job.external_job_id == external_job_id,
                    Job.tenant_id == tenant_id,
                ).limit(1)
            )
            job = result.scalar_one_or_none()
            if job is not None:
                return job
        if job_id and str(job_id) != DUMMY_JOB_UUID:
            result = await self._session.execute(
                select(Job).where(Job.id == job_id, Job.tenant_id == tenant_id).limit(1)
            )
            job = result.scalar_one_or_none()
            if job is not None:
                return job
        if external_job_id:
            return await self.resolve_or_create_job(actor, external_job_id)
        raise NotFoundError(public_message="Job not found")

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
            screening_questions=get_default_screening_questions(payload.title),
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
        self, actor: User, job_id: uuid.UUID, payload, external_job_id: str | None = None
    ) -> Candidate:
        if external_job_id:
            job = await self.ensure_job(actor, job_id, external_job_id)
            job_id = job.id
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

    async def call_now(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> tuple[ScreeningCall, bool]:
        """Trigger a real Vapi screening call for a single candidate.

        The existing ``trigger_screening`` is a talentOS-integration bypass (it
        records a pass without dialing anyone). ``call_now`` instead places an
        actual call: validates the phone, rejects live calls, creates a fresh
        ``ScreeningCall`` row and enqueues the Celery dial task with
        ``force=True`` (dial immediately — the call-window scheduling used by
        the HR app is applied inside the dispatch).

        Unlike ``ScreeningTriggerService`` this does not require a POC
        shortlist approval row, because talentOS-moved candidates have no
        ``ShortlistResult`` here. Returns ``(call, immediate)``.
        """
        tenant_id = await self._effective_tenant_id(actor)
        await self._require_tenant_job(job_id, tenant_id)
        candidate = await self._session.get(Candidate, candidate_id)
        if candidate is None or candidate.job_id != job_id:
            raise NotFoundError(public_message="Candidate not found in this job")

        job = await self._session.get(Job, job_id)
        if job is None:
            raise NotFoundError(public_message="Job not found")

        from app.core.celery_queues import SCREENING_QUEUE
        from app.services.celery_health import (
            celery_queue_available_async,
            celery_queue_unavailable_message,
        )
        from app.services.phone_validation import validate_phone_with_reason
        from app.services.screening_dispatch_service import enqueue_screening_call
        from app.services.screening_gate_service import screening_disabled_reason
        from app.services.screening_trigger_service import candidate_has_live_call
        from app.services.settings_service import load_system_settings

        if not await celery_queue_available_async(SCREENING_QUEUE):
            raise ConflictError(
                public_message=celery_queue_unavailable_message(SCREENING_QUEUE),
            )

        system_settings = await load_system_settings(self._session, tenant_id=tenant_id)
        disabled_reason = screening_disabled_reason(system_settings, job)
        if disabled_reason:
            raise ConflictError(public_message=disabled_reason)

        if await candidate_has_live_call(self._session, job_id, candidate_id):
            raise ConflictError(
                public_message="A screening call is already in progress for this candidate",
            )

        if not candidate.phone:
            raise ValidationError(
                public_message="Candidate has no phone number on file",
            )

        is_valid, normalized_phone, reject_reason = await validate_phone_with_reason(
            candidate.phone,
            session=self._session,
            tenant_id=tenant_id,
        )
        if not is_valid:
            raise ValidationError(
                public_message=reject_reason or f"Invalid phone number: {candidate.phone}",
            )
        candidate.phone = normalized_phone

        screening_call = ScreeningCall(
            candidate_id=candidate_id,
            job_id=job_id,
            call_status="pending",
        )
        self._session.add(screening_call)
        await self._session.commit()
        await self._session.refresh(screening_call)

        immediate = enqueue_screening_call(screening_call.id, job, force=True)
        return screening_call, immediate

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

    async def get_screening_status(
        self, actor: User, job_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> dict | None:
        """Server-computed disposition for a candidate (pending/completed/flagged).

        Unlike get_screening_result this always returns a classification, even when
        no screening call exists yet (e.g. flagged for a missing/invalid phone).
        """
        tenant_id = await self._effective_tenant_id(actor)
        await self._require_tenant_job(job_id, tenant_id)
        candidate = await self._session.get(Candidate, candidate_id)
        if candidate is None or candidate.job_id != job_id:
            raise NotFoundError(public_message="Candidate not found in this job")

        call_result = await self._session.execute(
            select(ScreeningCall)
            .where(
                ScreeningCall.job_id == job_id,
                ScreeningCall.candidate_id == candidate_id,
            )
            .order_by(ScreeningCall.created_at.desc())
            .limit(1)
        )
        call = call_result.scalars().first()

        settings = await load_system_settings(self._session, tenant_id=tenant_id)
        disposition, flag_reason = classify_for_candidate(candidate, call, settings)

        if call is None:
            return {
                "disposition": disposition,
                "flag_reason": flag_reason,
                "has_call": False,
                "latest_call": None,
                "updated_at": candidate.created_at,
            }

        from app.modules.talentos_integration.talentos_integration_schema import (
            TalentosScreeningResultResponse,
        )

        latest_call = TalentosScreeningResultResponse.model_validate(call)
        latest_call.terminal_failure = self.is_terminal_screening_failure(call)

        return {
            "disposition": disposition,
            "flag_reason": flag_reason,
            "has_call": True,
            "latest_call": latest_call,
            "updated_at": call.created_at,
        }

    def is_terminal_screening_failure(self, call: ScreeningCall) -> bool:
        """True when the screening call finished and cannot recover on its own.

        Retries may still be pending when retry_count < the configured maximum,
        so those outcomes are NOT terminal failures yet.
        """
        if call.call_status not in TERMINAL_CALL_STATUSES:
            return False
        outcome = (call.call_outcome or "").lower()
        if outcome == "failed":
            return True
        if outcome in SCREENING_FAILURE_OUTCOMES:
            return call.retry_count >= getattr(settings, "screening_max_retries", 0)
        return False

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

    async def schedule_interview(
        self,
        actor: User,
        job_id: uuid.UUID,
        candidate_id: uuid.UUID,
        payload,
    ) -> InterviewSession:
        """Set (or clear) the scheduled slot on a candidate's pending session.

        payload is None → clears the slot (interview becomes immediately
        joinable). Only pending sessions can be scheduled; in-progress or
        completed sessions are left untouched.
        """
        tenant_id = await self._effective_tenant_id(actor)
        await self._require_tenant_job(job_id, tenant_id)
        candidate = await self._session.get(Candidate, candidate_id)
        if candidate is None or candidate.job_id != job_id:
            raise NotFoundError(public_message="Candidate not found in this job")

        result = await self._session.execute(
            select(InterviewSession)
            .where(
                InterviewSession.job_id == job_id,
                InterviewSession.candidate_id == candidate_id,
                InterviewSession.status == "pending",
            )
            .order_by(InterviewSession.created_at.desc())
            .limit(1)
        )
        session = result.scalars().first()
        if session is None:
            raise NotFoundError(
                public_message="No pending interview session found for this candidate"
            )

        has_slot = payload is not None and (
            payload.scheduled_date is not None or payload.scheduled_time is not None
        )
        if not has_slot:
            session.scheduled_interview_at = None
            logger.info(
                "Interview slot cleared: session=%s candidate=%s",
                session.id,
                candidate_id,
            )
        else:
            try:
                scheduled_at = _parse_scheduled_slot(
                    payload.scheduled_date,
                    payload.scheduled_time,
                    payload.timezone or "Asia/Kolkata",
                )
            except ValueError as exc:
                raise ValidationError(public_message=str(exc)) from exc
            now = datetime.now(timezone.utc)
            if scheduled_at < now - timedelta(minutes=1):
                raise ConflictError(public_message="Scheduled time must be in the future")
            session.scheduled_interview_at = scheduled_at
            session.expires_at = scheduled_at + timedelta(
                days=config.interview.session_link_ttl_days
            )
            logger.info(
                "Interview slot set: session=%s candidate=%s scheduled_at=%s",
                session.id,
                candidate_id,
                scheduled_at.isoformat(),
            )

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
            "transcript_segments": session.transcript_segments,
            "recording_key": session.recording_key,
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

    async def _find_job(
        self, actor: User, job_id: uuid.UUID, external_job_id: str | None
    ) -> Job | None:
        tenant_id = await self._effective_tenant_id(actor)
        if external_job_id:
            result = await self._session.execute(
                select(Job).where(
                    Job.external_job_id == external_job_id,
                    Job.tenant_id == tenant_id,
                ).limit(1)
            )
            job = result.scalar_one_or_none()
            if job is not None:
                return job
        try:
            return await self._require_tenant_job(job_id, tenant_id)
        except NotFoundError:
            return None

    async def get_job_questions(
        self, actor: User, job_id: uuid.UUID, external_job_id: str | None = None
    ) -> dict:
        job = await self._find_job(actor, job_id, external_job_id)
        if job is None:
            raise NotFoundError(public_message="Job not found")
        return {
            "job_id": job.id,
            "screening_questions": job.screening_questions or [],
            "interview_questions": job.interview_questions or [],
        }

    async def update_job_questions(
        self, actor: User, job_id: uuid.UUID, payload, external_job_id: str | None = None
    ) -> dict:
        job = await self._find_job(actor, job_id, external_job_id)
        if job is None:
            if external_job_id is None:
                raise NotFoundError(public_message="Job not found")
            job = await self.resolve_or_create_job(actor, external_job_id)
        updates = payload.model_dump(exclude_unset=True)
        if "screening_questions" in updates:
            job.screening_questions = updates["screening_questions"]
        if "interview_questions" in updates:
            job.interview_questions = updates["interview_questions"]
        await self._session.commit()
        await self._session.refresh(job)
        return {
            "job_id": job.id,
            "screening_questions": job.screening_questions or [],
            "interview_questions": job.interview_questions or [],
        }

    async def get_call_window(
        self, actor: User, job_id: uuid.UUID, external_job_id: str | None = None
    ) -> dict:
        job = await self._find_job(actor, job_id, external_job_id)
        if job is None:
            raise NotFoundError(public_message="Job not found")
        return {
            "job_id": job.id,
            "screening_call_from": job.screening_call_from,
            "screening_call_to": job.screening_call_to,
            "screening_timezone": job.screening_timezone or "Asia/Kolkata",
        }

    async def update_call_window(
        self, actor: User, job_id: uuid.UUID, payload, external_job_id: str | None = None
    ) -> dict:
        job = await self._find_job(actor, job_id, external_job_id)
        if job is None:
            if external_job_id is None:
                raise NotFoundError(public_message="Job not found")
            job = await self.resolve_or_create_job(actor, external_job_id)
        updates = payload.model_dump(exclude_unset=True)
        if "screening_call_from" in updates:
            job.screening_call_from = updates["screening_call_from"]
        if "screening_call_to" in updates:
            job.screening_call_to = updates["screening_call_to"]
        if "screening_timezone" in updates:
            job.screening_timezone = updates["screening_timezone"]
        await self._session.commit()
        await self._session.refresh(job)
        return {
            "job_id": job.id,
            "screening_call_from": job.screening_call_from,
            "screening_call_to": job.screening_call_to,
            "screening_timezone": job.screening_timezone or "Asia/Kolkata",
        }
