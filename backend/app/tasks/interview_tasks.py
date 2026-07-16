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

# Retry assessment until transcript is saved (agent may finish after /complete)
ASSESSMENT_RETRY_DELAY_SEC = 15
ASSESSMENT_MAX_ATTEMPTS = 12  # ~3 minutes


def enqueue_interview_assessment(interview_session_id: str) -> None:
    """Schedule assessment with retries — does not depend on the interview agent."""
    schedule_interview_assessment.delay(str(interview_session_id))


@celery_app.task(name="tasks.schedule_interview_assessment")
def schedule_interview_assessment(interview_session_id: str, attempt: int = 0):
    """
    Wait for transcript (saved by interview agent), then run generate_interview_report.
    Retries every ASSESSMENT_RETRY_DELAY_SEC until transcript exists or max attempts.
    """
    try:
        should_retry = asyncio.run(
            _async_maybe_start_assessment(interview_session_id, attempt)
        )
        if should_retry:
            schedule_interview_assessment.apply_async(
                args=[interview_session_id, attempt + 1],
                countdown=ASSESSMENT_RETRY_DELAY_SEC,
            )
    except Exception as exc:
        logger.error(
            "schedule_interview_assessment failed for session %s (attempt %s): %s",
            interview_session_id,
            attempt,
            exc,
        )
        if attempt < ASSESSMENT_MAX_ATTEMPTS:
            schedule_interview_assessment.apply_async(
                args=[interview_session_id, attempt + 1],
                countdown=ASSESSMENT_RETRY_DELAY_SEC,
            )


async def _async_maybe_start_assessment(interview_session_id: str, attempt: int) -> bool:
    """Return True to schedule another retry."""
    from app.models.models import InterviewSession, InterviewReport
    from app.services.assessment_service import MIN_TRANSCRIPT_LENGTH

    session_uuid = uuid.UUID(interview_session_id)

    async with get_celery_db() as db:
        session_result = await db.execute(
            select(InterviewSession).where(InterviewSession.id == session_uuid)
        )
        interview_session = session_result.scalars().first()
        if not interview_session:
            logger.warning(
                "schedule_interview_assessment: session %s not found",
                interview_session_id,
            )
            return False

        report_result = await db.execute(
            select(InterviewReport).where(
                InterviewReport.interview_session_id == session_uuid
            )
        )
        if report_result.scalars().first():
            logger.info(
                "schedule_interview_assessment: report already exists for session %s",
                interview_session_id,
            )
            return False

        if interview_session.status not in ("completed", "assessed", "assessment_failed"):
            if attempt >= ASSESSMENT_MAX_ATTEMPTS:
                logger.warning(
                    "schedule_interview_assessment: session %s never completed — forcing assessment",
                    interview_session_id,
                )
                generate_interview_report.delay(interview_session_id)
                return False
            return True

        transcript = (interview_session.transcript or "").strip()
        has_transcript = len(transcript) >= MIN_TRANSCRIPT_LENGTH

        if has_transcript or attempt >= ASSESSMENT_MAX_ATTEMPTS:
            logger.info(
                "schedule_interview_assessment: starting report for session %s "
                "(attempt=%s, transcript_chars=%d)",
                interview_session_id,
                attempt,
                len(transcript),
            )
            generate_interview_report.delay(interview_session_id)
            return False

        logger.info(
            "schedule_interview_assessment: waiting for transcript session=%s attempt=%s",
            interview_session_id,
            attempt,
        )
        return True


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
        from app.services.tenant_integrations_service import load_tenant_integrations

        integrations = await load_tenant_integrations(db, job.tenant_id)
        integrations.require("openai_api_key")

        assessment = await generate_assessment(
            transcript=transcript,
            job=job,
            candidate=candidate,
            api_key=integrations.openai_api_key,
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
        is_rubric = assessment.get("assessment_mode") == "rubric"
        if is_rubric:
            report.technical_fit_score = None
            report.communication_score = None
            report.problem_solving_score = None
            report.experience_score = None
            report.role_alignment_score = None
            earned = assessment.get("overall_score")
            report.overall_score = float(earned) if earned is not None else None
        else:
            report.technical_fit_score = (
                float(assessment["technical_fit_score"])
                if assessment.get("technical_fit_score") is not None else None
            )
            report.communication_score = (
                float(assessment["communication_score"])
                if assessment.get("communication_score") is not None else None
            )
            report.problem_solving_score = (
                float(assessment["problem_solving_score"])
                if assessment.get("problem_solving_score") is not None else None
            )
            report.experience_score = (
                float(assessment["experience_score"])
                if assessment.get("experience_score") is not None else None
            )
            report.role_alignment_score = (
                float(assessment["role_alignment_score"])
                if assessment.get("role_alignment_score") is not None else None
            )
            earned = assessment.get("overall_score")
            report.overall_score = float(earned) if earned is not None else None
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
            "InterviewReport created for session=%s candidate=%s overall_score=%s recommendation=%s",
            interview_session_id,
            candidate.name,
            report.overall_score,
            report.final_recommendation,
        )


@celery_app.task(name="tasks.dispatch_scheduled_interview_emails")
def dispatch_scheduled_interview_emails():
    """Send interview invitation emails when scheduled_interview_at is reached."""
    try:
        asyncio.run(_async_dispatch_scheduled_interview_emails())
    except Exception as exc:
        logger.error("dispatch_scheduled_interview_emails failed: %s", exc)
        raise


async def _async_dispatch_scheduled_interview_emails() -> None:
    from app.services.interview_schedule_service import dispatch_due_scheduled_interview_emails

    async with get_celery_db() as session:
        sent = await dispatch_due_scheduled_interview_emails(session)
        if sent:
            logger.info("dispatch_scheduled_interview_emails: sent %d invitations", sent)
