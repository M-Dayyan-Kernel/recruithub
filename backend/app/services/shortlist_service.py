"""Shortlist query and HR decision orchestration."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_utils import run_sync
from app.core.logging import get_actor_label, log_event
from app.core.tenancy import get_tenant_job
from app.exceptions import ValidationError
from app.models.models import Candidate, Job, User
from app.repositories.shortlist_repository import ShortlistRepository
from app.schemas.schemas import (
    ShortlistDecisionResponse,
    ShortlistDecisionUpdate,
    ShortlistFeedbackCreate,
    ShortlistResultResponse,
    ShortlistResultWithCandidateResponse,
    ShortlistStatusResponse,
)
from app.services.audit_service import AuditService
from app.services.candidate_contact_service import (
    resolve_candidate_email,
    resolve_candidate_name,
)
from app.services.shortlist_batch_store import ShortlistBatchStore

logger = logging.getLogger(__name__)

_VALID_DECISIONS = frozenset({"approved", "rejected", "overridden"})


class ShortlistService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        shortlist_repo: ShortlistRepository | None = None,
        batch_store: ShortlistBatchStore | None = None,
        audit_service: AuditService | None = None,
    ) -> None:
        self._session = session
        self._shortlist = shortlist_repo or ShortlistRepository(session)
        self._batch_store = batch_store or ShortlistBatchStore()
        self._audit = audit_service or AuditService(session)

    async def get_status(
        self, actor: User, job_id: uuid.UUID
    ) -> ShortlistStatusResponse:
        await get_tenant_job(self._session, job_id, actor.tenant_id)

        try:
            in_progress, candidate_ids, failed = await run_sync(
                self._batch_store.read_status, job_id
            )
        except Exception as exc:
            logger.warning(
                "get_shortlist_status: Redis unavailable for job %s: %s", job_id, exc
            )
            in_progress = False
            candidate_ids = []
            failed = 0

        completed = 0
        if candidate_ids:
            cand_uuids = [uuid.UUID(cid) for cid in candidate_ids]
            completed = await self._shortlist.count_for_candidates(job_id, cand_uuids)

        logger.debug(
            "shortlist.progress job_id=%s in_progress=%s completed=%s/%s failed=%s",
            job_id,
            in_progress,
            completed,
            len(candidate_ids),
            failed,
        )

        return ShortlistStatusResponse(
            in_progress=in_progress,
            candidate_ids=candidate_ids,
            completed=completed,
            total=len(candidate_ids),
            failed=failed,
        )

    async def list_results(
        self, actor: User, job_id: uuid.UUID
    ) -> list[ShortlistResultWithCandidateResponse]:
        await get_tenant_job(self._session, job_id, actor.tenant_id)
        shortlist_records = await self._shortlist.list_for_job(job_id)

        if not shortlist_records:
            return []

        candidate_ids = [r.candidate_id for r in shortlist_records]
        candidates_result = await self._session.execute(
            select(Candidate).where(Candidate.id.in_(candidate_ids))
        )
        candidates_by_id = {c.id: c for c in candidates_result.scalars().all()}

        enriched: list[ShortlistResultWithCandidateResponse] = []
        for record in shortlist_records:
            candidate = candidates_by_id.get(record.candidate_id)
            parsed = (candidate.parsed_data or {}) if candidate else {}
            candidate_name = parsed.get("name") or (candidate.name if candidate else None)
            raw_email = parsed.get("email") or (candidate.email if candidate else None)
            candidate_email = (
                raw_email
                if raw_email and not str(raw_email).endswith("@upload.pending")
                else None
            )
            enriched.append(
                ShortlistResultWithCandidateResponse(
                    id=record.id,
                    candidate_id=record.candidate_id,
                    job_id=record.job_id,
                    match_score=record.match_score,
                    recommendation=record.recommendation,
                    strengths=record.strengths,
                    gaps=record.gaps,
                    reason=record.reason,
                    hr_decision=record.hr_decision,
                    hr_feedback_type=record.hr_feedback_type,
                    hr_comments=record.hr_comments,
                    created_at=record.created_at,
                    candidate_name=candidate_name,
                    candidate_email=candidate_email,
                )
            )

        logger.debug(
            "shortlist.listed job_id=%s results=%s",
            job_id,
            len(enriched),
        )
        return enriched

    async def update_decision(
        self,
        actor: User,
        shortlist_id: uuid.UUID,
        payload: ShortlistDecisionUpdate,
    ) -> ShortlistDecisionResponse:
        if payload.hr_decision not in _VALID_DECISIONS:
            raise ValidationError(
                public_message=(
                    f"hr_decision must be one of: {', '.join(sorted(_VALID_DECISIONS))}"
                ),
            )

        record = await self._shortlist.get_for_tenant(shortlist_id, actor.tenant_id)
        previous_decision = record.hr_decision
        record.hr_decision = payload.hr_decision
        candidate = await self._session.get(Candidate, record.candidate_id)
        subject = resolve_candidate_name(candidate) if candidate else str(record.candidate_id)

        await self._audit.log_change(
            actor=actor,
            action="shortlist.decision_set",
            entity_type="shortlist",
            entity_id=record.id,
            subject_label=subject,
            feature="hr_decision",
            before={"hr_decision": previous_decision},
            after={"hr_decision": payload.hr_decision},
            job_id=record.job_id,
            candidate_id=record.candidate_id,
        )
        await self._session.commit()
        await self._shortlist.refresh(record)

        log_event(
            logger,
            "%s changed the shortlist decision for %s on job review from %s to %s (AI had recommended %s)",
            get_actor_label(),
            subject,
            previous_decision.replace("_", " "),
            payload.hr_decision.replace("_", " "),
            record.recommendation.replace("_", " "),
        )

        if payload.hr_decision == "rejected" and previous_decision != "rejected":
            await self._send_rejection_email(actor, record, shortlist_id, candidate)
        elif payload.hr_decision == "rejected" and previous_decision == "rejected":
            logger.debug(
                "Skipping rejection email for shortlist=%s (already rejected)",
                shortlist_id,
            )

        if payload.hr_decision == "approved":
            approval_response = await self._handle_approval_side_effects(
                actor, record
            )
            if approval_response is not None:
                return approval_response

        return ShortlistDecisionResponse.model_validate(record)

    async def submit_feedback(
        self,
        actor: User,
        shortlist_id: uuid.UUID,
        payload: ShortlistFeedbackCreate,
    ) -> ShortlistResultResponse:
        record = await self._shortlist.get_for_tenant(shortlist_id, actor.tenant_id)
        changes = {
            "hr_feedback_type": (record.hr_feedback_type, payload.hr_feedback_type),
            "hr_comments": (record.hr_comments, payload.hr_comments),
        }
        record.hr_feedback_type = payload.hr_feedback_type
        record.hr_comments = payload.hr_comments
        candidate = await self._session.get(Candidate, record.candidate_id)
        subject = resolve_candidate_name(candidate) if candidate else str(record.candidate_id)

        await self._audit.log_field_changes(
            actor=actor,
            action="shortlist.feedback_set",
            entity_type="shortlist",
            entity_id=record.id,
            subject_label=subject,
            changes=changes,
            job_id=record.job_id,
            candidate_id=record.candidate_id,
        )
        await self._session.commit()
        await self._shortlist.refresh(record)
        return ShortlistResultResponse.model_validate(record)

    async def _send_rejection_email(
        self,
        actor: User,
        record,
        shortlist_id: uuid.UUID,
        candidate: Candidate | None,
    ) -> None:
        candidate_email = resolve_candidate_email(candidate)
        if not candidate_email:
            logger.warning(
                "Rejection decision saved but no valid email for shortlist=%s candidate=%s",
                shortlist_id,
                record.candidate_id,
            )
            return

        job = await self._session.get(Job, record.job_id)
        job_title = job.title if job else "the position"
        from app.services.email_service import send_rejection_email
        from app.services.email_template_service import get_company_name, get_merged_templates

        templates = await get_merged_templates(self._session, actor.tenant_id)
        company_name = await get_company_name(self._session, actor.tenant_id)
        logger.info(
            "Sending rejection email to %s for shortlist=%s",
            candidate_email,
            shortlist_id,
        )
        if not await send_rejection_email(
            resolve_candidate_name(candidate),
            candidate_email,
            job_title,
            templates=templates,
            company_name=company_name,
        ):
            logger.warning(
                "Rejection decision saved but email failed for shortlist=%s candidate=%s",
                shortlist_id,
                record.candidate_id,
            )

    async def _handle_approval_side_effects(
        self,
        actor: User,
        record,
    ) -> ShortlistDecisionResponse | None:
        from app.services.screening_gate_service import (
            bypass_summary_for,
            is_voice_screening_effective,
        )
        from app.services.settings_service import load_system_settings

        system_settings = await load_system_settings(
            self._session, tenant_id=actor.tenant_id
        )
        job = await self._session.get(Job, record.job_id)
        if not job or not is_voice_screening_effective(system_settings, job):
            from app.services.interview_skip_screening_service import (
                advance_approved_candidate_to_interview,
            )

            bypass_summary = (
                bypass_summary_for(system_settings, job)
                if job
                else "Screening bypassed — voice screening disabled"
            )
            advance = await advance_approved_candidate_to_interview(
                self._session,
                candidate_id=record.candidate_id,
                job_id=record.job_id,
                bypass_summary=bypass_summary,
            )
            return ShortlistDecisionResponse(
                **ShortlistResultResponse.model_validate(record).model_dump(),
                screening_skipped=True,
                interview_session_id=advance.session_id,
                interview_email_sent=advance.email_sent,
            )

        from app.services.call_window_service import is_within_call_window
        from app.services.celery_health import celery_workers_available_async
        from app.services.screening_trigger_service import (
            auto_dispatch_unqueued_approved_for_job,
            candidate_has_any_screening_call,
        )

        if await celery_workers_available_async():
            job = await self._session.get(Job, record.job_id)
            if job and is_within_call_window(job):
                if not await candidate_has_any_screening_call(
                    self._session, record.job_id, record.candidate_id
                ):
                    await auto_dispatch_unqueued_approved_for_job(self._session, job)

        return None
