"""
Assessment Service — Sprint 6

GPT-4o powered interview assessment. Analyzes the interview transcript against
the job description and candidate profile to produce a structured scorecard.

Functions:
  - generate_assessment(transcript, job, candidate) → dict
"""

import json
import logging

from app.clients import mocks, openai_client
from app.core.config_loader import config
from app.prompts.assessment import (
    ASSESSMENT_SYSTEM_PROMPT,
    build_assessment_user_prompt,
    build_rubric_assessment_prompt,
)

logger = logging.getLogger(__name__)

# Backward-compatible private alias for existing imports/tests.
_rubric_assessment_prompt = build_rubric_assessment_prompt


def _build_needs_review_report(rubric: list[dict] | None = None) -> dict:
    """Return a default report when transcript is too short to assess."""
    report = {
        "technical_fit_score": None,
        "communication_score": None,
        "problem_solving_score": None,
        "experience_score": None,
        "role_alignment_score": None,
        "overall_score": None,
        "strengths": [],
        "weaknesses": ["Interview transcript unavailable or too short for assessment"],
        "jd_fit": "Unable to assess — transcript was empty or insufficient.",
        "final_recommendation": "needs_review",
        "summary": "No assessable transcript was recorded for this interview. Manual review required.",
        "transcript_summary": "No transcript available.",
        "assessment_mode": "legacy",
    }
    if rubric:
        report["assessment_mode"] = "rubric"
        report["rubric_total"] = sum(int(q.get("score") or 0) for q in rubric)
        report["question_scores"] = [
            _empty_question_score_entry(q)
            for q in rubric
        ]
    return report


def _empty_question_score_entry(q: dict) -> dict:
    expected = _coerce_expected_points(q.get("expected_points"))
    entry = {
        "id": q.get("id", ""),
        "question": q.get("question", ""),
        "score": int(q.get("score") or 0),
        "earned_score": 0 if expected else None,
        "notes": "Not assessable — transcript too short.",
        "candidate_answer": "",
        "expected_points": expected or None,
        "candidate_points": [],
        "point_coverage": (
            [{"point": p, "covered": False} for p in expected] if expected else None
        ),
    }
    return entry


def _coerce_expected_points(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(p).strip() for p in raw if str(p).strip()]


def rubric_has_expected_points(rubric: list | None) -> bool:
    if not rubric:
        return False
    for item in rubric:
        if isinstance(item, dict) and _coerce_expected_points(item.get("expected_points")):
            return True
    return False


def question_scores_need_coverage_refresh(
    question_scores: list | None,
    rubric: list | None,
) -> bool:
    """True when rubric has expected_points but stored scores lack point_coverage."""
    if not rubric_has_expected_points(rubric):
        return False
    if not question_scores:
        return True

    rubric_ids_with_expected = {
        str(q.get("id"))
        for q in (rubric or [])
        if isinstance(q, dict) and _coerce_expected_points(q.get("expected_points"))
    }
    if not rubric_ids_with_expected:
        return False

    scores_by_id = {
        str(qs.get("id")): qs
        for qs in question_scores
        if isinstance(qs, dict) and qs.get("id")
    }
    for qid in rubric_ids_with_expected:
        qs = scores_by_id.get(qid)
        if not qs or not qs.get("point_coverage"):
            return True
    return False


def _normalize_point_coverage(
    expected_points: list[str],
    gpt_coverage: list | None,
) -> list[dict]:
    if not expected_points:
        return []
    coverage_by_point: dict[str, bool] = {}
    if isinstance(gpt_coverage, list):
        for item in gpt_coverage:
            if not isinstance(item, dict):
                continue
            point = str(item.get("point") or "").strip()
            if point:
                coverage_by_point[point.lower()] = bool(item.get("covered"))

    normalized = []
    for point in expected_points:
        key = point.lower()
        covered = coverage_by_point.get(key, False)
        if not covered and isinstance(gpt_coverage, list):
            for item in gpt_coverage:
                if not isinstance(item, dict):
                    continue
                gpt_point = str(item.get("point") or "").strip().lower()
                if gpt_point and (gpt_point in key or key in gpt_point):
                    covered = bool(item.get("covered"))
                    break
        normalized.append({"point": point, "covered": covered})
    return normalized


def _coverage_earned_score(max_score: int, point_coverage: list[dict]) -> int:
    if not point_coverage:
        return 0
    covered = sum(1 for p in point_coverage if p.get("covered"))
    total = len(point_coverage) or 1
    return round(max_score * covered / total)


def _normalize_rubric_questions(raw: list | None) -> list[dict]:
    if not raw:
        return []
    normalized = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        question = (item.get("question") or "").strip()
        if not question:
            continue
        normalized.append({
            "id": str(item.get("id") or ""),
            "question": question,
            "score": int(item.get("score") or 0),
            "expected_points": _coerce_expected_points(item.get("expected_points")) or None,
        })
    return [q for q in normalized if q["score"] > 0]


def _merge_rubric_scores(rubric: list[dict], gpt_scores: list[dict]) -> tuple[list[dict], int]:
    by_id = {str(s.get("id")): s for s in gpt_scores if isinstance(s, dict)}
    merged = []
    total_earned = 0
    for q in rubric:
        qid = str(q.get("id") or "")
        gpt = by_id.get(qid, {})
        max_score = int(q.get("score") or 0)
        expected_points = _coerce_expected_points(q.get("expected_points"))

        raw_candidate_points = gpt.get("candidate_points")
        candidate_points = (
            [str(p).strip() for p in raw_candidate_points if str(p).strip()]
            if isinstance(raw_candidate_points, list)
            else []
        )

        if expected_points:
            point_coverage = _normalize_point_coverage(
                expected_points,
                gpt.get("point_coverage"),
            )
            earned = _coverage_earned_score(max_score, point_coverage)
        else:
            point_coverage = None
            try:
                earned = int(gpt.get("earned_score", 0))
            except (TypeError, ValueError):
                earned = 0
            earned = max(0, min(earned, max_score))

        total_earned += earned
        merged.append({
            "id": qid,
            "question": q.get("question", ""),
            "score": max_score,
            "earned_score": earned,
            "notes": gpt.get("notes") or "",
            "candidate_answer": (gpt.get("candidate_answer") or "").strip(),
            "expected_points": expected_points or None,
            "candidate_points": candidate_points or None,
            "point_coverage": point_coverage,
        })
    return merged, total_earned


async def _run_gpt_assessment(system_prompt: str, user_content: str, api_key: str) -> dict:
    content = await openai_client().chat_completion_json(
        "interview_assessment",
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        api_key=api_key,
    )
    return json.loads(content)


def _build_user_content(transcript: str, job, candidate) -> str:
    if candidate.parsed_data:
        parsed = candidate.parsed_data
        exp = parsed.get("total_experience_years", "Unknown")
        skills = parsed.get("skills") or []
        candidate_summary = (
            f"Experience: {exp} years\n"
            f"Skills: {', '.join(skills) if isinstance(skills, list) else skills}"
        )
    else:
        candidate_summary = f"Name: {candidate.name}"

    return build_assessment_user_prompt(
        job_title=job.title,
        required_skills=job.required_skills or [],
        experience_min=job.experience_min,
        experience_max=job.experience_max,
        job_description=job.description or "",
        candidate_name=candidate.name,
        candidate_summary=candidate_summary,
        transcript=transcript,
    )


async def generate_assessment(transcript: str, job, candidate, api_key: str) -> dict:
    """
    Generate a structured interview assessment using GPT-4o.
    Uses rubric-based scoring when job.interview_questions is set; otherwise legacy 0-100 dimensions.
    """
    import openai

    rubric = _normalize_rubric_questions(job.interview_questions)

    if not transcript or len(transcript.strip()) < config.parsing.min_transcript_chars:
        logger.warning(
            "generate_assessment: transcript too short (%d chars) — returning needs_review",
            len(transcript) if transcript else 0,
        )
        return _build_needs_review_report(rubric if rubric else None)

    if mocks.mock_openai_enabled():
        return mocks.mock_interview_assessment(transcript, job, candidate)

    user_content = _build_user_content(transcript, job, candidate)

    try:
        if rubric:
            system_prompt = _rubric_assessment_prompt(rubric)
            result = await _run_gpt_assessment(system_prompt, user_content, api_key)
            question_scores, total_earned = _merge_rubric_scores(
                rubric, result.get("question_scores") or []
            )
            rubric_total = sum(q["score"] for q in rubric)
            report = {
                "assessment_mode": "rubric",
                "question_scores": question_scores,
                "rubric_total": rubric_total,
                "overall_score": total_earned,
                "technical_fit_score": None,
                "communication_score": None,
                "problem_solving_score": None,
                "experience_score": None,
                "role_alignment_score": None,
                "strengths": result.get("strengths") or [],
                "weaknesses": result.get("weaknesses") or [],
                "jd_fit": result.get("jd_fit", ""),
                "final_recommendation": result.get("final_recommendation", "needs_review"),
                "summary": result.get("summary", ""),
                "transcript_summary": result.get("transcript_summary", ""),
            }
        else:
            result = await _run_gpt_assessment(ASSESSMENT_SYSTEM_PROMPT, user_content, api_key)
            required_keys = [
                "technical_fit_score", "communication_score", "problem_solving_score",
                "experience_score", "role_alignment_score", "overall_score",
                "strengths", "weaknesses", "jd_fit", "final_recommendation",
                "summary", "transcript_summary",
            ]
            for key in required_keys:
                if key not in result:
                    result[key] = 0 if "score" in key else (
                        "needs_review" if key == "final_recommendation" else ""
                    )
            result["assessment_mode"] = "legacy"
            report = result

        logger.info(
            "Assessment generated for candidate=%s job=%s mode=%s overall_score=%s recommendation=%s",
            candidate.name,
            job.title,
            report.get("assessment_mode"),
            report.get("overall_score"),
            report.get("final_recommendation"),
        )
        return report

    except openai.AuthenticationError as exc:
        logger.error("OpenAI auth error during assessment: %s", exc)
        raise

    except (openai.RateLimitError, openai.APIConnectionError) as exc:
        logger.warning("OpenAI transient error during assessment: %s", exc)
        raise

    except Exception as exc:
        logger.error("generate_assessment failed: %s", exc)
        report = _build_needs_review_report(rubric if rubric else None)
        report["summary"] = f"Assessment failed: {type(exc).__name__}. Manual review required."
        return report
