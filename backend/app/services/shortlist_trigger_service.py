"""Shortlist batch trigger orchestration."""

from __future__ import annotations

import logging
import uuid
from typing import Optional

import redis as redis_lib
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_utils import run_sync
from app.core.celery_queues import RESUME_QUEUE
from app.core.logging import get_actor_label, log_event, plural
from app.core.tenancy import get_tenant_job
from app.exceptions import (
    NoEligibleCandidatesError,
    ShortlistInProgressError,
    ShortlistUnavailableError,
)
from app.models.models import Candidate, ShortlistResult, User
from app.repositories.candidate_repository import CandidateRepository
from app.repositories.shortlist_repository import ShortlistRepository
from app.schemas.schemas import ShortlistTriggerRequest
from app.services.audit_service import AuditService
from app.services.celery_health import (
    celery_queue_available_async,
    celery_queue_unavailable_message,
)
from app.services.shortlist_batch_store import ShortlistBatchStore

logger = logging.getLogger(__name__)


class ShortlistTriggerService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        shortlist_repo: ShortlistRepository | None = None,
        candidate_repo: CandidateRepository | None = None,
        batch_store: ShortlistBatchStore | None = None,
        audit_service: AuditService | None = None,
    ) -> None:
        self._session = session
        self._shortlist = shortlist_repo or ShortlistRepository(session)
        self._candidates = candidate_repo or CandidateRepository(session)
        self._batch_store = batch_store or ShortlistBatchStore()
        self._audit = audit_service or AuditService(session)

    async def trigger(
        self,
        actor: User,
        job_id: uuid.UUID,
        body: Optional[ShortlistTriggerRequest] = None,
    ) -> dict:
        job = await get_tenant_job(self._session, job_id, actor.tenant_id)

        requested_ids = body.candidate_ids if body else None
        force = bool(body.force) if body else False
        eligible_ids, skipped = await self._resolve_eligible_candidate_ids(
            job_id, requested_ids, force=force
        )

        if not eligible_ids:
            raise NoEligibleCandidatesError(skipped=skipped)

        if not await celery_queue_available_async(RESUME_QUEUE):
            raise ShortlistUnavailableError(
                public_message=celery_queue_unavailable_message(RESUME_QUEUE),
            )

        try:
            acquired = await run_sync(self._batch_store.acquire_lock, job_id)
        except redis_lib.RedisError as exc:
            logger.error(
                "trigger_shortlist: Redis unavailable for job %s: %s", job_id, exc
            )
            raise ShortlistUnavailableError() from exc

        if not acquired:
            raise ShortlistInProgressError()

        id_strings = [str(cid) for cid in eligible_ids]
        try:
            await run_sync(self._batch_store.prepare_batch, job_id, id_strings)

            from app.tasks.shortlist_tasks import run_shortlist  # noqa: PLC0415

            run_shortlist.apply_async(args=[str(job_id), id_strings, force])
        except Exception as exc:
            logger.exception(
                "trigger_shortlist: failed to enqueue shortlist for job %s", job_id
            )
            try:
                await run_sync(self._batch_store.clear_keys, job_id)
            except redis_lib.RedisError:
                pass
            raise ShortlistUnavailableError() from exc

        await self._audit.log_change(
            actor=actor,
            action="shortlist.triggered",
            entity_type="job",
            entity_id=job_id,
            subject_label=job.title,
            feature="shortlist",
            before=None,
            after={
                "candidate_count": len(id_strings),
                "candidate_ids": id_strings,
                "force": force,
            },
            job_id=job_id,
        )
        await self._session.commit()

        log_event(
            logger,
            "%s started AI shortlisting for job \"%s\" with %s%s%s",
            get_actor_label(),
            job.title,
            plural(len(id_strings), "candidate"),
            f" (skipped {plural(len(skipped), 'ineligible candidate')})" if skipped else "",
            " (force re-score)" if force else "",
        )

        response = {
            "status": "shortlisting_started",
            "job_id": str(job_id),
            "candidate_ids": id_strings,
            "force": force,
        }
        if skipped:
            response["skipped"] = skipped
        return response

    async def _resolve_eligible_candidate_ids(
        self,
        job_id: uuid.UUID,
        requested_ids: Optional[list[uuid.UUID]],
        *,
        force: bool = False,
    ) -> tuple[list[uuid.UUID], list[dict]]:
        stmt = select(Candidate).where(
            Candidate.job_id == job_id,
            Candidate.pipeline_status == "completed",
        )
        if not force:
            shortlist_exists = (
                select(ShortlistResult.id)
                .where(ShortlistResult.candidate_id == Candidate.id)
                .correlate(Candidate)
            )
            stmt = stmt.where(~exists(shortlist_exists))
        if requested_ids is not None:
            stmt = stmt.where(Candidate.id.in_(requested_ids))

        result = await self._session.execute(stmt)
        eligible = [c.id for c in result.scalars().all()]

        skipped: list[dict] = []
        if requested_ids is not None:
            eligible_set = set(eligible)
            for raw_id in requested_ids:
                if raw_id in eligible_set:
                    continue
                cand = await self._session.get(Candidate, raw_id)
                if not cand or cand.job_id != job_id:
                    skipped.append(
                        {"id": str(raw_id), "reason": "Candidate not found for this job"}
                    )
                elif cand.pipeline_status != "completed":
                    skipped.append(
                        {
                            "id": str(raw_id),
                            "reason": (
                                f"pipeline_status is '{cand.pipeline_status}', "
                                "expected 'completed'"
                            ),
                        }
                    )
                elif not force and await self._shortlist.has_result_for_candidate(raw_id):
                    skipped.append({"id": str(raw_id), "reason": "Already shortlisted"})
                else:
                    skipped.append(
                        {"id": str(raw_id), "reason": "Not eligible for shortlisting"}
                    )

        return eligible, skipped
