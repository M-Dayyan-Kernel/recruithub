"""Audit logging for HR/Admin mutations."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import get_tenant_candidate
from app.exceptions import NotFoundError
from app.models.models import AuditLog, Candidate, Job, User
from app.repositories.audit_log_repository import AuditLogRepository
from app.schemas.schemas import AuditLogListResponse, AuditLogResponse

logger = logging.getLogger(__name__)

_REDACT_KEYS = frozenset(
    {
        "password",
        "hashed_password",
        "access_token",
        "token",
        "secret",
        "jwt",
        "credentials",
        "resume_raw_text",
    }
)


def _redact_value(key: str, value: Any) -> Any:
    if key.lower() in _REDACT_KEYS or any(
        k in key.lower() for k in ("password", "token", "secret")
    ):
        return "[redacted]"
    return value


def redact_state(state: Optional[dict]) -> Optional[dict]:
    if state is None:
        return None
    return {k: _redact_value(k, v) for k, v in state.items()}


class AuditService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        repo: AuditLogRepository | None = None,
    ) -> None:
        self._session = session
        self._repo = repo or AuditLogRepository(session)

    async def log_change(
        self,
        *,
        actor: User,
        action: str,
        entity_type: str,
        entity_id: Optional[uuid.UUID],
        subject_label: str,
        feature: str,
        before: Optional[dict],
        after: Optional[dict],
        job_id: Optional[uuid.UUID] = None,
        candidate_id: Optional[uuid.UUID] = None,
    ) -> None:
        row = AuditLog(
            tenant_id=actor.tenant_id,
            actor_user_id=actor.id,
            actor_name=actor.full_name,
            actor_role=actor.role,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            subject_label=(subject_label or "")[:500],
            feature=feature,
            before_state=redact_state(before),
            after_state=redact_state(after),
            job_id=job_id,
            candidate_id=candidate_id,
        )
        self._repo.add(row)
        await self._repo.flush()
        logger.debug(
            "%s recorded a %s change on %s (%s)",
            actor.full_name or actor.role,
            action.replace(".", " ").replace("_", " "),
            subject_label or entity_type,
            feature.replace("_", " "),
        )

    async def log_field_changes(
        self,
        *,
        actor: User,
        action: str,
        entity_type: str,
        entity_id: Optional[uuid.UUID],
        subject_label: str,
        changes: dict[str, tuple[Any, Any]],
        job_id: Optional[uuid.UUID] = None,
        candidate_id: Optional[uuid.UUID] = None,
    ) -> None:
        for feature, (before_val, after_val) in changes.items():
            if before_val == after_val:
                continue
            await self.log_change(
                actor=actor,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                subject_label=subject_label,
                feature=feature,
                before={feature: before_val},
                after={feature: after_val},
                job_id=job_id,
                candidate_id=candidate_id,
            )

    async def list_logs(
        self,
        *,
        tenant_id: uuid.UUID,
        limit: int,
        offset: int,
        entity_type: str | None = None,
        category: str | None = None,
        job_id: uuid.UUID | None = None,
        candidate_id: uuid.UUID | None = None,
        actor_user_id: uuid.UUID | None = None,
        from_ts: datetime | None = None,
        to_ts: datetime | None = None,
        search: str | None = None,
    ) -> AuditLogListResponse:
        if candidate_id:
            candidate = await get_tenant_candidate(self._session, candidate_id, tenant_id)
            if job_id and candidate.job_id != job_id:
                raise NotFoundError(public_message="Candidate not found for this job")

        filters = AuditLogRepository.build_filters(
            tenant_id=tenant_id,
            entity_type=entity_type,
            category=category,
            job_id=job_id,
            candidate_id=candidate_id,
            actor_user_id=actor_user_id,
            from_ts=from_ts,
            to_ts=to_ts,
            search=search,
        )
        total = await self._repo.count_filtered(filters)
        rows = await self._repo.list_filtered(filters, limit=limit, offset=offset)
        return AuditLogListResponse(
            items=await self._with_existence(rows, tenant_id),
            total=total,
            limit=limit,
            offset=offset,
        )


    async def _with_existence(self, rows, tenant_id: uuid.UUID) -> list[AuditLogResponse]:
        """Mark which of the page's jobs and candidates still exist: two lookups per page."""
        items = [AuditLogResponse.model_validate(r) for r in rows]
        job_ids = {i.job_id for i in items if i.job_id} | {
            i.entity_id for i in items if i.entity_type == "job" and i.entity_id
        }
        candidate_ids = {i.candidate_id for i in items if i.candidate_id} | {
            i.entity_id for i in items if i.entity_type == "candidate" and i.entity_id
        }
        live_jobs: set[uuid.UUID] = set()
        live_candidates: set[uuid.UUID] = set()
        if job_ids:
            live_jobs = set(
                (await self._session.execute(
                    select(Job.id).where(Job.id.in_(job_ids), Job.tenant_id == tenant_id)
                )).scalars()
            )
        if candidate_ids:
            live_candidates = set(
                (await self._session.execute(
                    select(Candidate.id)
                    .join(Job, Candidate.job_id == Job.id)
                    .where(Candidate.id.in_(candidate_ids), Job.tenant_id == tenant_id)
                )).scalars()
            )
        for item in items:
            job_id = item.job_id or (item.entity_id if item.entity_type == "job" else None)
            candidate_id = item.candidate_id or (item.entity_id if item.entity_type == "candidate" else None)
            item.job_exists = job_id in live_jobs
            item.candidate_exists = candidate_id in live_candidates
        return items


# --- backward-compatible module shims -----------------------------------------
async def log_change(db: AsyncSession, **kwargs) -> None:
    await AuditService(db).log_change(**kwargs)


async def log_field_changes(db: AsyncSession, **kwargs) -> None:
    await AuditService(db).log_field_changes(**kwargs)
