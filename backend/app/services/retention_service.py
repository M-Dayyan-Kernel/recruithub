"""Data retention and GDPR erasure helpers."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Candidate, Job, SystemSettings
from app.services.s3_service import delete_object, is_s3_object_key

logger = logging.getLogger(__name__)


async def erase_candidate_pii(
    session: AsyncSession,
    candidate: Candidate,
    *,
    tenant_id: uuid.UUID,
) -> None:
    """Remove PII and storage objects; keep anonymized row for referential integrity."""
    if candidate.resume_file_path and is_s3_object_key(candidate.resume_file_path):
        delete_object(candidate.resume_file_path)

    candidate.name = "Erased"
    candidate.email = f"erased-{candidate.id.hex[:12]}@erased.local"
    candidate.phone = None
    candidate.parsed_data = None
    candidate.resume_file_path = None
    candidate.original_filename = None
    await session.flush()


async def apply_retention_for_tenant(session: AsyncSession, tenant_id: uuid.UUID) -> int:
    settings = await session.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
    )
    row = settings.scalars().first()
    days = int(row.data_retention_days if row else 365)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    jobs = await session.execute(select(Job.id).where(Job.tenant_id == tenant_id))
    job_ids = [r[0] for r in jobs.all()]
    if not job_ids:
        return 0

    result = await session.execute(
        select(Candidate).where(
            Candidate.job_id.in_(job_ids),
            Candidate.created_at < cutoff,
        )
    )
    candidates = result.scalars().all()
    erased = 0
    for candidate in candidates:
        if candidate.email.endswith("@erased.local"):
            continue
        await erase_candidate_pii(session, candidate, tenant_id=tenant_id)
        erased += 1
    if erased:
        await session.commit()
    return erased
