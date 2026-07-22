"""Audit logging helpers for HR/Admin mutations."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AuditLog, User

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
    if key.lower() in _REDACT_KEYS or any(k in key.lower() for k in ("password", "token", "secret")):
        return "[redacted]"
    return value


def redact_state(state: Optional[dict]) -> Optional[dict]:
    if state is None:
        return None
    return {k: _redact_value(k, v) for k, v in state.items()}


async def log_change(
    db: AsyncSession,
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
    """Insert an audit row in the current transaction (caller commits)."""
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
    db.add(row)
    await db.flush()
    # Per-row audit details stay in the DB; avoid flooding INFO on bulk uploads.
    logger.debug(
        "%s recorded a %s change on %s (%s)",
        actor.full_name or actor.role,
        action.replace(".", " ").replace("_", " "),
        subject_label or entity_type,
        feature.replace("_", " "),
    )


async def log_field_changes(
    db: AsyncSession,
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
    """One audit row per changed field: changes = {feature: (before, after)}."""
    for feature, (before_val, after_val) in changes.items():
        if before_val == after_val:
            continue
        await log_change(
            db,
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
