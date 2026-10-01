"""Tenant-scoped query helpers for shared-DB multi-tenancy."""

from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Candidate, Job, ScreeningCall, ShortlistResult, User


def slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return (base or "org")[:80]


async def get_tenant_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> Job:
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.tenant_id == tenant_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


async def get_tenant_candidate(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> Candidate:
    result = await db.execute(
        select(Candidate)
        .join(Job, Candidate.job_id == Job.id)
        .where(Candidate.id == candidate_id, Job.tenant_id == tenant_id)
    )
    candidate = result.scalar_one_or_none()
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    return candidate


async def get_tenant_shortlist_result(
    db: AsyncSession,
    shortlist_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> ShortlistResult:
    result = await db.execute(
        select(ShortlistResult)
        .join(Job, ShortlistResult.job_id == Job.id)
        .where(ShortlistResult.id == shortlist_id, Job.tenant_id == tenant_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shortlist result not found",
        )
    return record


async def get_tenant_screening_call(
    db: AsyncSession,
    screening_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> ScreeningCall:
    result = await db.execute(
        select(ScreeningCall)
        .join(Job, ScreeningCall.job_id == Job.id)
        .where(ScreeningCall.id == screening_id, Job.tenant_id == tenant_id)
    )
    screening_call = result.scalar_one_or_none()
    if not screening_call:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening call not found",
        )
    return screening_call


async def ensure_unique_slug(db: AsyncSession, name: str) -> str:
    from app.models.models import Tenant

    base = slugify(name)
    slug = base
    n = 2
    while True:
        existing = await db.execute(select(Tenant.id).where(Tenant.slug == slug).limit(1))
        if existing.scalar_one_or_none() is None:
            return slug
        slug = f"{base}-{n}"[:80]
        n += 1


def require_user_tenant(user: User) -> uuid.UUID:
    if user.tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not assigned to an organization",
        )
    return user.tenant_id
