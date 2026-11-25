"""Tenant-wide candidate directory queries."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Candidate,
    InterviewReport,
    InterviewSession,
    Job,
    ScreeningCall,
    ShortlistResult,
)


PLACEHOLDER_EMAIL_SUFFIX = "@upload.pending"
# What a phone search may contain; anything else (letters, "@") is a name or email search.
PHONE_QUERY = re.compile(r"^\+?[\d\s().-]+$")
# Fewer digits than this match half the directory, which is noise rather than a search.
PHONE_MIN_DIGITS = 3


def _like_escape(text: str) -> str:
    """Make `%`, `_` and the escape character itself literal, so "50%" is not a wildcard."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_clause(q: str):
    """Match the term against name, email or phone.

    The placeholder address a resume without an email gets is excluded: it is not something a
    person sees, so searching "pending" or "upload" must not turn those rows up. Phones are
    stored as typed ("+91-98765 43210"), so they compare as digits only.
    """
    text = q.strip()
    term = f"%{_like_escape(text)}%"
    clauses = [
        Candidate.name.ilike(term, escape="\\"),
        and_(
            Candidate.email.ilike(term, escape="\\"),
            ~Candidate.email.ilike(f"%{PLACEHOLDER_EMAIL_SUFFIX}", escape="\\"),
        ),
    ]
    digits = re.sub(r"\D", "", text)
    if PHONE_QUERY.match(text) and len(digits) >= PHONE_MIN_DIGITS:
        stored_digits = func.regexp_replace(func.coalesce(Candidate.phone, ""), r"\D", "", "g")
        clauses.append(stored_digits.like(f"%{digits}%"))
    return or_(*clauses)


@dataclass
class CandidateDirectoryRow:
    candidate: Candidate
    job_title: str
    shortlist: ShortlistResult | None
    screening: ScreeningCall | None
    interview_session: InterviewSession | None
    interview_report: InterviewReport | None


class CandidateDirectoryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def _base_stmt(self, tenant_id: uuid.UUID):
        return (
            select(Candidate, Job.title)
            .join(Job, Candidate.job_id == Job.id)
            .where(Job.tenant_id == tenant_id)
        )

    def _apply_filters(
        self,
        stmt,
        *,
        job_id: uuid.UUID | None = None,
        q: str | None = None,
    ):
        if job_id is not None:
            stmt = stmt.where(Candidate.job_id == job_id)
        if q and q.strip():
            stmt = stmt.where(search_clause(q))
        # `id` breaks ties so a page boundary never repeats or drops a row that shares a timestamp.
        return stmt.order_by(Candidate.created_at.desc(), Candidate.id)

    async def list_all_for_tenant(
        self,
        tenant_id: uuid.UUID,
        *,
        job_id: uuid.UUID | None = None,
        q: str | None = None,
    ) -> list[tuple[Candidate, str]]:
        stmt = self._apply_filters(
            self._base_stmt(tenant_id),
            job_id=job_id,
            q=q,
        )
        result = await self._session.execute(stmt)
        return list(result.all())

    async def list_for_tenant(
        self,
        tenant_id: uuid.UUID,
        *,
        job_id: uuid.UUID | None = None,
        q: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> list[tuple[Candidate, str]]:
        stmt = self._apply_filters(
            self._base_stmt(tenant_id),
            job_id=job_id,
            q=q,
        )
        result = await self._session.execute(stmt.offset(offset).limit(limit))
        return list(result.all())

    async def count_for_tenant(
        self,
        tenant_id: uuid.UUID,
        *,
        job_id: uuid.UUID | None = None,
        q: str | None = None,
    ) -> int:
        stmt = self._apply_filters(
            self._base_stmt(tenant_id),
            job_id=job_id,
            q=q,
        )
        count_stmt = select(func.count()).select_from(stmt.subquery())
        return int((await self._session.execute(count_stmt)).scalar() or 0)

    async def _latest_shortlist(self, candidate_id: uuid.UUID) -> ShortlistResult | None:
        result = await self._session.execute(
            select(ShortlistResult)
            .where(ShortlistResult.candidate_id == candidate_id)
            .order_by(ShortlistResult.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _latest_screening(self, candidate_id: uuid.UUID) -> ScreeningCall | None:
        result = await self._session.execute(
            select(ScreeningCall)
            .where(ScreeningCall.candidate_id == candidate_id)
            .order_by(ScreeningCall.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _latest_session(self, candidate_id: uuid.UUID) -> InterviewSession | None:
        result = await self._session.execute(
            select(InterviewSession)
            .where(InterviewSession.candidate_id == candidate_id)
            .order_by(InterviewSession.round_number.desc(), InterviewSession.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _latest_report(self, candidate_id: uuid.UUID) -> InterviewReport | None:
        result = await self._session.execute(
            select(InterviewReport)
            .where(InterviewReport.candidate_id == candidate_id)
            .order_by(InterviewReport.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_profile_row(
        self, tenant_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> CandidateDirectoryRow | None:
        result = await self._session.execute(
            select(Candidate, Job.title)
            .join(Job, Candidate.job_id == Job.id)
            .where(Candidate.id == candidate_id, Job.tenant_id == tenant_id)
        )
        row = result.one_or_none()
        if row is None:
            return None
        candidate, job_title = row
        return CandidateDirectoryRow(
            candidate=candidate,
            job_title=job_title,
            shortlist=await self._latest_shortlist(candidate_id),
            screening=await self._latest_screening(candidate_id),
            interview_session=await self._latest_session(candidate_id),
            interview_report=await self._latest_report(candidate_id),
        )
