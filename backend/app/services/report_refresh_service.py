"""Refresh stale rubric reports so question_scores include point_coverage."""

import logging
from typing import Any

from app.services.assessment_service import (
    MIN_TRANSCRIPT_LENGTH,
    generate_assessment,
    rubric_has_expected_points,
    question_scores_need_coverage_refresh,
)

logger = logging.getLogger(__name__)


def apply_assessment_to_report(report: Any, assessment: dict) -> None:
    """Populate InterviewReport ORM fields from an assessment dict."""
    is_rubric = assessment.get("assessment_mode") == "rubric"
    if is_rubric:
        report.technical_fit_score = None
        report.communication_score = None
        report.problem_solving_score = None
        report.experience_score = None
        report.role_alignment_score = None
    else:
        report.technical_fit_score = (
            float(assessment["technical_fit_score"])
            if assessment.get("technical_fit_score") is not None
            else None
        )
        report.communication_score = (
            float(assessment["communication_score"])
            if assessment.get("communication_score") is not None
            else None
        )
        report.problem_solving_score = (
            float(assessment["problem_solving_score"])
            if assessment.get("problem_solving_score") is not None
            else None
        )
        report.experience_score = (
            float(assessment["experience_score"])
            if assessment.get("experience_score") is not None
            else None
        )
        report.role_alignment_score = (
            float(assessment["role_alignment_score"])
            if assessment.get("role_alignment_score") is not None
            else None
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


async def ensure_job_expected_points(job: Any, db: Any) -> bool:
    """Generate expected_points on the job rubric when missing. Returns True if job was updated."""
    rubric = job.interview_questions or []
    if not rubric or rubric_has_expected_points(rubric):
        return False

    from app.services.expected_answer_service import enrich_interview_questions

    job.interview_questions = await enrich_interview_questions(rubric, rubric, job)
    await db.flush()
    logger.info("Generated expected_points for job %s rubric", job.id)
    return True


async def ensure_report_has_coverage(
    db: Any,
    report: Any,
    job: Any,
    candidate: Any,
    transcript: str,
) -> bool:
    """
    Re-run rubric assessment when the stored report lacks point_coverage
    but the job rubric has expected_points. Returns True if report was refreshed.
    """
    raw = report.raw_report or {}
    if raw.get("assessment_mode") != "rubric":
        return False

    if not transcript or len(transcript.strip()) < MIN_TRANSCRIPT_LENGTH:
        return False

    await ensure_job_expected_points(job, db)

    rubric = job.interview_questions or []
    if not rubric_has_expected_points(rubric):
        return False

    question_scores = raw.get("question_scores") or []
    if not question_scores_need_coverage_refresh(question_scores, rubric):
        return False

    logger.info(
        "Refreshing rubric report %s for candidate %s — adding point coverage",
        report.id,
        candidate.id if candidate else "?",
    )
    assessment = await generate_assessment(
        transcript=transcript,
        job=job,
        candidate=candidate,
    )
    apply_assessment_to_report(report, assessment)
    await db.commit()
    await db.refresh(report)
    return True
