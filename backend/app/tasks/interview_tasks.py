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
from app.core.config_loader import config
from app.core.database import get_celery_db

logger = logging.getLogger(__name__)

# Retry assessment until transcript is saved (agent may finish after /complete)
ASSESSMENT_RETRY_DELAY_SEC = config.interview.assessment_retry.delay_sec
ASSESSMENT_MAX_ATTEMPTS = config.interview.assessment_retry.max_attempts


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
        has_transcript = len(transcript) >= config.parsing.min_transcript_chars

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


async def _mark_session_assessment_failed(interview_session_id: str) -> None:
    from app.models.models import InterviewSession

    session_uuid = uuid.UUID(interview_session_id)
    async with get_celery_db() as db:
        result = await db.execute(
            select(InterviewSession).where(InterviewSession.id == session_uuid)
        )
        interview_session = result.scalars().first()
        if not interview_session:
            return
        if interview_session.status != "assessed":
            interview_session.status = "assessment_failed"
            await db.commit()
            logger.error(
                "generate_interview_report: marked session %s as assessment_failed",
                interview_session_id,
            )


@celery_app.task(name="tasks.generate_interview_report", bind=True, max_retries=2)
def generate_interview_report(self, interview_session_id: str):
    """
    Celery task: generate AI assessment report from interview transcript.

    Enqueued by POST /api/interview/{token}/complete.
    On success: creates InterviewReport + updates session status to "assessed".
    On transient OpenAI errors: self.retry; on exhaustion / auth: assessment_failed.
    Empty transcript yields a soft needs_review report (not assessment_failed).
    """
    import openai
    from celery.exceptions import MaxRetriesExceededError

    try:
        asyncio.run(_async_generate_report(self, interview_session_id))
    except openai.AuthenticationError as exc:
        logger.error(
            "generate_interview_report auth failure for session %s: %s",
            interview_session_id,
            exc,
        )
        asyncio.run(_mark_session_assessment_failed(interview_session_id))
    except (openai.RateLimitError, openai.APIConnectionError) as exc:
        logger.warning(
            "generate_interview_report transient OpenAI error for session %s — retrying: %s",
            interview_session_id,
            exc,
        )
        try:
            raise self.retry(
                exc=exc,
                countdown=config.celery.rate_limit_countdown_sec,
            )
        except MaxRetriesExceededError:
            asyncio.run(_mark_session_assessment_failed(interview_session_id))
    except MaxRetriesExceededError:
        asyncio.run(_mark_session_assessment_failed(interview_session_id))
    except Exception as exc:
        logger.error(
            "generate_interview_report failed for session %s: %s",
            interview_session_id,
            exc,
        )
        try:
            raise self.retry(exc=exc, countdown=ASSESSMENT_RETRY_DELAY_SEC)
        except MaxRetriesExceededError:
            asyncio.run(_mark_session_assessment_failed(interview_session_id))


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

        from app.services.tenant_integrations_service import load_tenant_integrations

        try:
            integrations = await load_tenant_integrations(db, job.tenant_id)
            integrations.require("openai_api_key")
        except ValueError as exc:
            logger.error(
                "generate_interview_report: integrations missing for session %s: %s",
                interview_session_id,
                exc,
            )
            interview_session.status = "assessment_failed"
            await db.commit()
            return

        # May raise Auth / RateLimit / APIConnection for Celery retry handling
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

        await _push_interview_to_talentos_be(
            job=job,
            candidate=candidate,
            interview_session=interview_session,
            report=report,
        )


def _serialize_interview(interview_session, report) -> dict:
    def _iso(dt):
        return dt.isoformat() if dt is not None else None

    return {
        "id": str(interview_session.id),
        "status": interview_session.status,
        "hr_decision": getattr(interview_session, "hr_decision", None),
        "interview_url": getattr(interview_session, "interview_url", None),
        "created_at": _iso(getattr(interview_session, "created_at", None)),
        "started_at": _iso(getattr(interview_session, "started_at", None)),
        "completed_at": _iso(getattr(interview_session, "completed_at", None)),
        "transcript": getattr(interview_session, "transcript", None),
        "summary": getattr(report, "summary", None),
        "transcript_summary": getattr(report, "transcript_summary", None),
        "overall_score": getattr(report, "overall_score", None),
        "technical_fit_score": getattr(report, "technical_fit_score", None),
        "communication_score": getattr(report, "communication_score", None),
        "problem_solving_score": getattr(report, "problem_solving_score", None),
        "experience_score": getattr(report, "experience_score", None),
        "role_alignment_score": getattr(report, "role_alignment_score", None),
        "strengths": getattr(report, "strengths", None),
        "weaknesses": getattr(report, "weaknesses", None),
        "jd_fit": getattr(report, "jd_fit", None),
        "final_recommendation": getattr(report, "final_recommendation", None),
    }


async def _push_interview_to_talentos_be(*, job, candidate, interview_session, report) -> None:
    external_job_id = getattr(job, "external_job_id", None)
    external_candidate_id = getattr(candidate, "external_candidate_id", None)
    if not external_job_id or not external_candidate_id:
        return
    try:
        from app.modules.talentos_integration.talentos_be_client import TalentosBEClient

        client = TalentosBEClient()
        await client.push_interview_completion(
            external_job_id=str(external_job_id),
            external_candidate_id=str(external_candidate_id),
            interview_id=str(interview_session.id),
            result=_serialize_interview(interview_session, report),
        )
    except Exception as exc:
        logger.warning(
            "Failed to push interview completion to talentOS BE (session=%s): %s",
            interview_session.id, exc,
        )

