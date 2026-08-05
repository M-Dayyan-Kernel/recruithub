"""HR-facing interview orchestration (queue, schedule, pipeline, decisions)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.tenancy import get_tenant_candidate, get_tenant_job
from app.models.models import Candidate, InterviewSession, Job, ScreeningCall, User
from app.repositories.interview_repository import InterviewRepository
from app.schemas.schemas import (
    FinalistsResponse,
    InterviewHrDecisionUpdate,
    InterviewPipelineResponse,
    InterviewScheduleRequest,
    InterviewSessionResponse,
)
from app.services.audit_service import AuditService
from app.services.interview_public_service import _STUB_INTERVIEW_TRANSCRIPT

logger = logging.getLogger(__name__)


class InterviewHrService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        interview_repo: InterviewRepository | None = None,
        audit_service: AuditService | None = None,
    ) -> None:
        self._session = session
        self._interviews = interview_repo or InterviewRepository(session)
        self._audit = audit_service or AuditService(session)

    async def _candidate_label(
        self, candidate: Candidate | None, candidate_id: uuid.UUID
    ) -> str:
        if candidate and candidate.name:
            return candidate.name
        if candidate and candidate.original_filename:
            return candidate.original_filename
        return str(candidate_id)

    async def _mark_interview_queued(
        self,
        candidate_id: uuid.UUID,
        job_id: uuid.UUID,
        *,
        skip_check: bool = False,
    ) -> ScreeningCall | None:
        if skip_check:
            return None
        screening_call = await self._interviews.get_latest_pass_screening_call(
            job_id, candidate_id
        )
        if not screening_call:
            raise HTTPException(
                status_code=400,
                detail="Candidate has not passed screening. Cannot queue for interview.",
            )
        screening_call.interview_queued_at = datetime.now(timezone.utc)
        await self._interviews.flush()
        return screening_call

    async def queue(self, actor: User, candidate_id: uuid.UUID) -> dict:
        """
        HR action: add a passed screening candidate to the interview pipeline (Pending tab)
        without sending the interview link yet.
        """
        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)

        await self._mark_interview_queued(
            candidate_id,
            candidate.job_id,
            skip_check=candidate.waives_screening_pass,
        )
        await self._audit.log_change(
            actor=actor,
            action="interview.queued",
            entity_type="interview",
            entity_id=candidate_id,
            subject_label=await self._candidate_label(candidate, candidate_id),
            feature="interview_queue",
            before=None,
            after={"queued": True},
            job_id=candidate.job_id,
            candidate_id=candidate_id,
        )
        await self._session.commit()

        return {
            "message": "Candidate queued for interview",
            "candidate_id": str(candidate_id),
        }

    async def schedule(
        self,
        actor: User,
        candidate_id: uuid.UUID,
        body: InterviewScheduleRequest,
    ) -> InterviewSessionResponse:
        """
        Create an interview session for a specific date/time.

        The candidate is emailed immediately with the interview link and the
        scheduled slot (not deferred until the slot arrives).
        """
        from app.services.interview_schedule_service import (
            parse_scheduled_at,
            send_scheduled_interview_notification_email,
        )

        try:
            scheduled_at = parse_scheduled_at(body)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        now = datetime.now(timezone.utc)
        if scheduled_at < now - timedelta(minutes=1):
            raise HTTPException(
                status_code=422,
                detail="Scheduled time must be in the future.",
            )

        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)

        if not candidate.waives_screening_pass and not await self._interviews.get_latest_pass_screening_call(
            candidate.job_id, candidate_id
        ):
            raise HTTPException(
                status_code=400,
                detail="Candidate has not passed screening. Interview cannot be scheduled.",
            )

        existing_result = await self._session.execute(
            select(InterviewSession).where(
                InterviewSession.candidate_id == candidate_id,
                InterviewSession.job_id == candidate.job_id,
                InterviewSession.status.in_(["pending", "in_progress"]),
            )
        )
        if existing_result.scalars().first():
            raise HTTPException(
                status_code=409,
                detail="An active interview session already exists for this candidate.",
            )

        unique_token = str(uuid.uuid4())
        interview_session = InterviewSession(
            candidate_id=candidate_id,
            job_id=candidate.job_id,
            unique_token=unique_token,
            status="pending",
            scheduled_interview_at=scheduled_at,
            expires_at=scheduled_at + timedelta(days=config.interview.session_link_ttl_days),
        )
        self._session.add(interview_session)
        await self._interviews.flush()

        await self._mark_interview_queued(candidate_id, candidate.job_id)

        job_result = await self._session.execute(select(Job).where(Job.id == candidate.job_id))
        job = job_result.scalars().first()
        job_title = job.title if job else "the position"

        interview_url = f"{config.CANDIDATE_APP_URL}/interview/{unique_token}"

        email_sent = await send_scheduled_interview_notification_email(
            self._session,
            interview_session,
            candidate,
            job_title,
            timezone_name=body.timezone or "Asia/Kolkata",
        )
        if not email_sent:
            logger.warning(
                "Interview scheduled for candidate=%s but notification email failed",
                candidate_id,
            )

        await self._audit.log_change(
            actor=actor,
            action="interview.scheduled",
            entity_type="interview",
            entity_id=interview_session.id,
            subject_label=await self._candidate_label(candidate, candidate_id),
            feature="scheduled_interview_at",
            before=None,
            after={"scheduled_interview_at": scheduled_at.isoformat()},
            job_id=candidate.job_id,
            candidate_id=candidate_id,
        )
        await self._session.commit()
        await self._interviews.refresh(interview_session)

        response_data = InterviewSessionResponse.model_validate(interview_session)
        response_data.interview_url = interview_url
        response_data.candidate_name = candidate.name
        response_data.job_title = job_title
        return response_data

    async def send_link(
        self, actor: User, candidate_id: uuid.UUID
    ) -> InterviewSessionResponse:
        """
        Create an InterviewSession and send the interview link to the candidate.

        Requires:
        - Candidate exists
        - A ScreeningCall with result='pass' exists for this candidate
        - No active (pending/in_progress) session already exists

        Email failure is non-fatal — session is still created and link is returned.
        """
        from app.services.interview_schedule_service import send_interview_invitation_email
        from app.services.interview_session_service import create_pending_interview_session

        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)

        screening_result = await self._session.execute(
            select(ScreeningCall).where(
                ScreeningCall.candidate_id == candidate_id,
                ScreeningCall.result == "pass",
            )
        )
        screening_call = screening_result.scalars().first()
        if not candidate.waives_screening_pass and not screening_call:
            raise HTTPException(
                status_code=400,
                detail="Candidate has not passed screening. Interview cannot be scheduled.",
            )

        try:
            interview_session, candidate, job_title = await create_pending_interview_session(
                self._session,
                candidate_id=candidate_id,
                job_id=candidate.job_id,
            )
        except ValueError as exc:
            detail = str(exc)
            if "already exists" in detail:
                raise HTTPException(status_code=409, detail=detail) from exc
            raise HTTPException(status_code=400, detail=detail) from exc

        await self._mark_interview_queued(
            candidate_id,
            candidate.job_id,
            skip_check=candidate.waives_screening_pass,
        )

        interview_url = f"{config.CANDIDATE_APP_URL}/interview/{interview_session.unique_token}"

        await send_interview_invitation_email(
            self._session, interview_session, candidate, job_title
        )

        await self._audit.log_change(
            actor=actor,
            action="interview.link_sent",
            entity_type="interview",
            entity_id=interview_session.id,
            subject_label=await self._candidate_label(candidate, candidate_id),
            feature="interview_link",
            before=None,
            after={"status": interview_session.status},
            job_id=candidate.job_id,
            candidate_id=candidate_id,
        )
        await self._session.commit()
        await self._interviews.refresh(interview_session)

        response_data = InterviewSessionResponse.model_validate(interview_session)
        response_data.interview_url = interview_url
        response_data.candidate_name = candidate.name
        response_data.job_title = job_title

        return response_data

    async def mark_complete(
        self, actor: User, candidate_id: uuid.UUID
    ) -> InterviewSessionResponse:
        """
        HR action: force-complete a pending/in-progress interview so the candidate
        moves to the Completed pipeline tab (and assessment is generated).
        """
        from app.services.interview_flag_service import has_meaningful_transcript
        from app.tasks.interview_tasks import generate_interview_report

        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)

        result = await self._session.execute(
            select(InterviewSession)
            .where(
                InterviewSession.candidate_id == candidate_id,
                InterviewSession.job_id == candidate.job_id,
                InterviewSession.status.in_(["pending", "in_progress"]),
            )
            .order_by(InterviewSession.created_at.desc())
        )
        session = result.scalars().first()
        if not session:
            raise HTTPException(
                status_code=404,
                detail="No active interview session found to mark complete.",
            )

        now = datetime.now(timezone.utc)
        before_status = session.status
        session.status = "completed"
        session.completed_at = now
        if not session.started_at:
            session.started_at = now

        from app.clients.mocks import mock_livekit_enabled

        if not has_meaningful_transcript(session.transcript) and mock_livekit_enabled():
            session.transcript = _STUB_INTERVIEW_TRANSCRIPT

        await self._audit.log_change(
            actor=actor,
            action="interview.mark_complete",
            entity_type="interview_session",
            entity_id=session.id,
            subject_label=await self._candidate_label(candidate, candidate_id),
            job_id=candidate.job_id,
            candidate_id=candidate_id,
            feature="status",
            before={"status": before_status},
            after={"status": "completed"},
        )
        await self._session.commit()
        await self._interviews.refresh(session)

        try:
            generate_interview_report.delay(str(session.id))
        except Exception as exc:
            logger.error(
                "Failed to enqueue assessment after mark_complete for session %s: %s",
                session.id,
                exc,
            )

        job_result = await self._session.execute(select(Job).where(Job.id == candidate.job_id))
        job = job_result.scalars().first()

        response_data = InterviewSessionResponse.model_validate(session)
        response_data.interview_url = (
            f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
        )
        response_data.candidate_name = candidate.name
        response_data.job_title = job.title if job else None
        logger.info(
            "HR marked interview complete: session=%s candidate=%s",
            session.id,
            candidate_id,
        )
        return response_data

    async def list_for_job(
        self, actor: User, job_id: uuid.UUID
    ) -> list[InterviewSessionResponse]:
        """
        HR view: list all interview sessions for a job, enriched with candidate_name
        and interview_url. Ordered newest-first.
        """
        job = await get_tenant_job(self._session, job_id, actor.tenant_id)

        sessions = await self._interviews.list_for_job(job_id)

        if not sessions:
            return []

        candidate_ids = list({s.candidate_id for s in sessions})
        candidate_result = await self._session.execute(
            select(Candidate).where(Candidate.id.in_(candidate_ids))
        )
        candidate_map = {c.id: c for c in candidate_result.scalars().all()}

        enriched: list[InterviewSessionResponse] = []
        for session in sessions:
            r = InterviewSessionResponse.model_validate(session)
            r.interview_url = f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
            c = candidate_map.get(session.candidate_id)
            r.candidate_name = c.name if c else None
            r.job_title = job.title
            enriched.append(r)

        return enriched

    async def get_pipeline(
        self,
        actor: User,
        job_id: uuid.UUID,
        tab: Optional[
            Literal["pending", "scheduled", "ongoing", "completed", "flagged", "finalists"]
        ] = None,
    ) -> InterviewPipelineResponse:
        """
        HR view: screening-passed candidates grouped into interview pipeline tabs.

        Tabs:
          - scheduled: no session yet, or link sent (session status pending)
          - pending: legacy alias for scheduled
          - ongoing: session in_progress
          - completed: session completed (pending/rejected HR decision)
          - finalists: completed and HR-approved
          - flagged: interview never produced a meaningful result
        """
        from app.services.interview_pipeline_service import (
            get_interview_pipeline as build_pipeline,
        )

        await get_tenant_job(self._session, job_id, actor.tenant_id)
        try:
            return await build_pipeline(self._session, job_id, tab=tab)
        except ValueError as exc:
            if str(exc) == "Job not found":
                raise HTTPException(status_code=404, detail="Job not found") from exc
            raise

    async def get_finalists(
        self, actor: User, job_id: uuid.UUID
    ) -> FinalistsResponse:
        """List HR-approved finalists for a job (post-interview)."""
        from app.services.interview_finalist_service import list_finalists

        await get_tenant_job(self._session, job_id, actor.tenant_id)
        try:
            return await list_finalists(self._session, job_id)
        except ValueError as exc:
            if str(exc) == "Job not found":
                raise HTTPException(status_code=404, detail="Job not found") from exc
            raise

    async def update_decision(
        self,
        actor: User,
        candidate_id: uuid.UUID,
        payload: InterviewHrDecisionUpdate,
    ) -> InterviewSessionResponse:
        """Approve (move to Finalists) or reject (keep in Completed) after interview."""
        from app.services.interview_finalist_service import set_interview_hr_decision

        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)
        try:
            before_decision = None
            sess_result = await self._session.execute(
                select(InterviewSession)
                .where(InterviewSession.candidate_id == candidate_id)
                .order_by(InterviewSession.created_at.desc())
                .limit(1)
            )
            latest = sess_result.scalars().first()
            if latest:
                before_decision = latest.hr_decision

            result = await set_interview_hr_decision(
                self._session, candidate_id, payload.hr_decision
            )
            await self._audit.log_change(
                actor=actor,
                action="interview.decision_set",
                entity_type="interview",
                entity_id=result.id if hasattr(result, "id") else candidate_id,
                subject_label=await self._candidate_label(candidate, candidate_id),
                feature="hr_decision",
                before={"hr_decision": before_decision},
                after={"hr_decision": payload.hr_decision},
                job_id=candidate.job_id if candidate else None,
                candidate_id=candidate_id,
            )
            await self._session.commit()
            return result
        except ValueError as exc:
            msg = str(exc)
            if msg == "Candidate not found":
                raise HTTPException(status_code=404, detail=msg) from exc
            raise HTTPException(status_code=400, detail=msg) from exc

    async def resend_email(
        self, actor: User, candidate_id: uuid.UUID
    ) -> InterviewSessionResponse:
        """Resend the interview invitation email for a pending session."""
        from app.services.interview_schedule_service import resend_interview_notification_email

        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)

        session_result = await self._session.execute(
            select(InterviewSession)
            .where(
                InterviewSession.candidate_id == candidate_id,
                InterviewSession.job_id == candidate.job_id,
                InterviewSession.status == "pending",
            )
            .order_by(InterviewSession.created_at.desc())
            .limit(1)
        )
        session = session_result.scalars().first()
        if not session:
            raise HTTPException(
                status_code=404,
                detail="No pending interview session found for this candidate.",
            )

        job = await self._session.get(Job, candidate.job_id)
        job_title = job.title if job else "the position"
        timezone_name = (job.screening_timezone if job else None) or "Asia/Kolkata"

        email_sent = await resend_interview_notification_email(
            self._session,
            session,
            candidate,
            job_title,
            timezone_name=timezone_name,
        )
        if not email_sent:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Failed to send interview email. Check Gmail configuration "
                    "and that the candidate has a valid email address."
                ),
            )

        await self._audit.log_change(
            actor=actor,
            action="interview.email_resent",
            entity_type="interview",
            entity_id=session.id,
            subject_label=await self._candidate_label(candidate, candidate_id),
            feature="interview_link",
            before=None,
            after={"email_sent_at": session.email_sent_at.isoformat() if session.email_sent_at else None},
            job_id=candidate.job_id,
            candidate_id=candidate_id,
        )
        await self._session.commit()
        await self._interviews.refresh(session)

        response_data = InterviewSessionResponse.model_validate(session)
        response_data.interview_url = f"{config.CANDIDATE_APP_URL}/interview/{session.unique_token}"
        response_data.candidate_name = candidate.name
        response_data.job_title = job_title
        return response_data

    async def reschedule(
        self,
        actor: User,
        candidate_id: uuid.UUID,
        body: Optional[InterviewScheduleRequest] = None,
    ) -> InterviewSessionResponse:
        """
        Expire the previous interview link, create a new session, and email the candidate.
        """
        from app.services.interview_reschedule_service import reschedule_interview

        try:
            candidate = await get_tenant_candidate(
                self._session, candidate_id, actor.tenant_id
            )
            result = await reschedule_interview(
                self._session, candidate_id, schedule=body
            )
            await self._audit.log_change(
                actor=actor,
                action="interview.rescheduled",
                entity_type="interview",
                entity_id=result.id if hasattr(result, "id") else candidate_id,
                subject_label=await self._candidate_label(candidate, candidate_id),
                feature="interview_session",
                before=None,
                after={"session_id": str(result.id) if hasattr(result, "id") else None},
                job_id=candidate.job_id if candidate else None,
                candidate_id=candidate_id,
            )
            await self._session.commit()
            return result
        except ValueError as exc:
            msg = str(exc)
            if msg == "Candidate not found":
                raise HTTPException(status_code=404, detail=msg) from exc
            if "already exists" in msg:
                raise HTTPException(status_code=409, detail=msg) from exc
            raise HTTPException(status_code=400, detail=msg) from exc

    async def retry_assessment(
        self, actor: User, candidate_id: uuid.UUID
    ) -> dict:
        """Re-enqueue assessment generation for the latest failed interview session."""
        from app.tasks.interview_tasks import generate_interview_report

        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)

        result = await self._session.execute(
            select(InterviewSession)
            .where(InterviewSession.candidate_id == candidate_id)
            .order_by(InterviewSession.created_at.desc())
        )
        session = result.scalars().first()
        if not session:
            raise HTTPException(status_code=404, detail="No interview session found")

        if session.status != "assessment_failed":
            raise HTTPException(
                status_code=400,
                detail="Assessment retry is only available for failed assessments",
            )

        before_status = session.status
        session.status = "completed"
        await self._audit.log_change(
            actor=actor,
            action="interview.retry_assessment",
            entity_type="interview",
            entity_id=session.id,
            subject_label=await self._candidate_label(candidate, candidate_id),
            feature="status",
            before={"status": before_status},
            after={"status": "completed"},
            job_id=session.job_id,
            candidate_id=candidate_id,
        )
        await self._session.commit()

        try:
            generate_interview_report.delay(str(session.id))
        except Exception as exc:
            logger.error(
                "Failed to enqueue assessment retry for session %s: %s",
                session.id,
                exc,
            )
            raise HTTPException(
                status_code=503,
                detail="Assessment queue is temporarily unavailable. Try again shortly.",
            ) from exc
        return {
            "message": "Assessment retry enqueued",
            "session_id": str(session.id),
        }
