"""Interview report fetch and refresh for HR."""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import get_tenant_candidate
from app.models.models import InterviewReport, InterviewSession, Job, User
from app.repositories.interview_repository import InterviewRepository
from app.schemas.schemas import InterviewReportResponse
from app.services.interview_public_service import _ensure_recording_ready


class InterviewReportService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        interview_repo: InterviewRepository | None = None,
    ) -> None:
        self._session = session
        self._interviews = interview_repo or InterviewRepository(session)

    async def get_report(
        self, actor: User, candidate_id: uuid.UUID
    ) -> InterviewReportResponse:
        """Fetch the most recent interview report for a candidate.

        Returns 404 with 'Report not ready yet' when no report exists (assessment may still be running).
        Enriches response with candidate_name and job_title via joins.
        """
        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)

        session = await self._interviews.get_latest_session_for_candidate(candidate_id)

        report = None
        if session:
            scoped = await self._session.execute(
                select(InterviewReport).where(
                    InterviewReport.interview_session_id == session.id
                )
            )
            report = scoped.scalars().first()

        if not report:
            report = await self._interviews.get_report_for_candidate(candidate_id)

        if not report:
            raise HTTPException(status_code=404, detail="Report not ready yet")

        job_result = await self._session.execute(
            select(Job).where(Job.id == report.job_id)
        )
        job = job_result.scalars().first()

        if not session or session.id != report.interview_session_id:
            session_result = await self._session.execute(
                select(InterviewSession).where(
                    InterviewSession.id == report.interview_session_id
                )
            )
            session = session_result.scalars().first()

        report_dict = {
            col.key: getattr(report, col.key)
            for col in report.__table__.columns
        }
        report_dict["candidate_name"] = candidate.name if candidate else None
        report_dict["job_title"] = job.title if job else None

        raw = report.raw_report or {}
        if raw.get("assessment_mode") == "rubric":
            report_dict["question_scores"] = raw.get("question_scores")
            report_dict["rubric_total"] = raw.get("rubric_total")

        report_dict["transcript"] = session.transcript if session else None
        report_dict["transcript_segments"] = session.transcript_segments if session else None

        recording_key = session.recording_key if session else None
        report_dict["recording_key"] = recording_key
        report_dict["recording_url"] = None
        if session and recording_key and await _ensure_recording_ready(session, self._session):
            from app.services.s3_service import generate_presigned_get_url_async

            report_dict["recording_url"] = await generate_presigned_get_url_async(recording_key)

        return InterviewReportResponse.model_validate(report_dict)

    async def refresh_report(
        self, actor: User, candidate_id: uuid.UUID
    ) -> InterviewReportResponse:
        """Regenerate rubric point coverage via OpenAI when the stored report is stale."""
        candidate = await get_tenant_candidate(self._session, candidate_id, actor.tenant_id)

        session = await self._interviews.get_latest_session_for_candidate(candidate_id)
        if not session:
            raise HTTPException(status_code=404, detail="No interview session found")

        report_result = await self._session.execute(
            select(InterviewReport).where(
                InterviewReport.interview_session_id == session.id
            )
        )
        report = report_result.scalars().first()
        if not report:
            raise HTTPException(status_code=404, detail="Report not ready yet")

        job_result = await self._session.execute(select(Job).where(Job.id == report.job_id))
        job = job_result.scalars().first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        from app.services.report_refresh_service import ensure_report_has_coverage

        refreshed = await ensure_report_has_coverage(
            self._session,
            report,
            job,
            candidate,
            session.transcript or "",
        )
        if refreshed:
            await self._session.commit()
            await self._session.refresh(report)

        return await self.get_report(actor, candidate_id)
