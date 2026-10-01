"""Audit logging for HR/Admin mutations."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import get_tenant_candidate
from app.exceptions import NotFoundError
from app.models.models import AuditLog, User
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
            items=[AuditLogResponse.model_validate(r) for r in rows],
            total=total,
            limit=limit,
            offset=offset,
        )


# --- backward-compatible module shims -----------------------------------------
async def log_change(db: AsyncSession, **kwargs) -> None:
    await AuditService(db).log_change(**kwargs)


async def log_field_changes(db: AsyncSession, **kwargs) -> None:
    await AuditService(db).log_field_changes(**kwargs)
