"""
Interview Tasks — Sprint 6

Celery tasks for AI interview assessment pipeline.

Tasks:
  - generate_interview_report: load InterviewSession + Candidate + Job,
    run GPT-4o assessment, create InterviewReport, update session status.

Pattern: sync Celery wrapper → asyncio.run() → async inner function
DB sessions: get_celery_db() (NullPool) — mandatory for Celery on Windows event loop
"""

import asyncio
import logging
import uuid

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.database import get_celery_db

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.generate_interview_report", bind=True, max_retries=2)
def generate_interview_report(self, interview_session_id: str):
    """
    Celery task: generate AI assessment report from interview transcript.

    Enqueued by POST /api/interview/{token}/complete.
    On success: creates InterviewReport + updates session status to "assessed".
    On failure: marks session status as "assessment_failed".
    """
    try:
        asyncio.run(_async_generate_report(self, interview_session_id))
    except Exception as exc:
        logger.error("generate_interview_report failed for session %s: %s", interview_session_id, exc)
        raise


async def _async_generate_report(task_self, interview_session_id: str) -> None:
    """Async inner: load records, run assessment, persist InterviewReport."""
    from app.models.models import InterviewSession, Candidate, Job, InterviewReport
    from app.services.assessment_service import generate_assessment

    session_uuid = uuid.UUID(interview_session_id)

    async with get_celery_db() as db:
        # Load InterviewSession
        result = await db.execute(
            select(InterviewSession).where(InterviewSession.id == session_uuid)
        )
        interview_session = result.scalars().first()

        if not interview_session:
            logger.error(
                "generate_interview_report: InterviewSession %s not found — aborting",
                interview_session_id,
            )
            return

        # Load Candidate
        candidate_result = await db.execute(
            select(Candidate).where(Candidate.id == interview_session.candidate_id)
        )
        candidate = candidate_result.scalars().first()

        if not candidate:
            logger.error(
                "generate_interview_report: Candidate %s not found for session %s — aborting",
                interview_session.candidate_id,
                interview_session_id,
            )
            interview_session.status = "assessment_failed"
            await db.commit()
            return

        # Load Job
        job_result = await db.execute(
            select(Job).where(Job.id == interview_session.job_id)
        )
        job = job_result.scalars().first()

        if not job:
            logger.error(
                "generate_interview_report: Job %s not found for session %s — aborting",
                interview_session.job_id,
                interview_session_id,
            )
            interview_session.status = "assessment_failed"
            await db.commit()
            return

        # Handle missing transcript gracefully — assessment_service returns needs_review
        transcript = interview_session.transcript or ""

        if not transcript:
            logger.warning(
                "generate_interview_report: session %s has no transcript — generating needs_review report",
                interview_session_id,
            )

        # Run GPT-4o assessment (never raises — returns needs_review report on failure)
        assessment = await generate_assessment(
            transcript=transcript,
            job=job,
            candidate=candidate,
        )

        # Check for an existing report (idempotent — don't double-create)
        existing_result = await db.execute(
            select(InterviewReport).where(
                InterviewReport.interview_session_id == session_uuid
            )
        )
        existing_report = existing_result.scalars().first()

        if existing_report:
            logger.warning(
                "generate_interview_report: report already exists for session %s — updating",
                interview_session_id,
            )
            report = existing_report
        else:
            report = InterviewReport(
                interview_session_id=session_uuid,
                candidate_id=interview_session.candidate_id,
                job_id=interview_session.job_id,
            )
            db.add(report)

        # Populate report fields from assessment dict
        report.technical_fit_score = float(assessment.get("technical_fit_score", 0))
        report.communication_score = float(assessment.get("communication_score", 0))
        report.problem_solving_score = float(assessment.get("problem_solving_score", 0))
        report.experience_score = float(assessment.get("experience_score", 0))
        report.role_alignment_score = float(assessment.get("role_alignment_score", 0))
        report.overall_score = float(assessment.get("overall_score", 0))
        report.strengths = assessment.get("strengths") or []
        report.weaknesses = assessment.get("weaknesses") or []
        report.jd_fit = assessment.get("jd_fit", "")
        report.final_recommendation = assessment.get("final_recommendation", "needs_review")
        report.summary = assessment.get("summary", "")
        report.transcript_summary = assessment.get("transcript_summary", "")
        report.raw_report = assessment

        # Update session status
        interview_session.status = "assessed"

        await db.commit()

        logger.info(
            "InterviewReport created for session=%s candidate=%s overall_score=%.1f recommendation=%s",
            interview_session_id,
            candidate.name,
            report.overall_score,
            report.final_recommendation,
        )
