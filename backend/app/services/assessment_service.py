"""
Assessment Service — Sprint 6

GPT-4o powered interview assessment. Analyzes the interview transcript against
the job description and candidate profile to produce a structured scorecard.

Functions:
  - generate_assessment(transcript, job, candidate) → dict
"""

import json
import logging

logger = logging.getLogger(__name__)

MIN_TRANSCRIPT_LENGTH = 100

ASSESSMENT_SYSTEM_PROMPT = """You are an expert technical interviewer and talent evaluator.
You will be given:
1. An interview transcript
2. The job description and requirements
3. The candidate's profile

Your task is to objectively assess the candidate's performance and fit for the role.
Return ONLY valid JSON with the following exact fields (no extra keys, no markdown):

{
  "technical_fit_score": <integer 0-100>,
  "communication_score": <integer 0-100>,
  "problem_solving_score": <integer 0-100>,
  "experience_score": <integer 0-100>,
  "role_alignment_score": <integer 0-100>,
  "overall_score": <integer 0-100>,
  "strengths": ["<strength 1>", "<strength 2>", "..."],
  "weaknesses": ["<weakness 1>", "<weakness 2>", "..."],
  "jd_fit": "<2-3 sentence assessment of how well the candidate fits the JD requirements>",
  "final_recommendation": "<one of: strong_hire | hire | hold | no_hire>",
  "summary": "<3-5 sentence executive summary of the interview performance>",
  "transcript_summary": "<2-3 sentence factual summary of what was discussed in the interview>"
}

Scoring guidelines:
- technical_fit_score: depth of technical knowledge demonstrated relevant to the role
- communication_score: clarity, articulation, structured thinking in responses
- problem_solving_score: ability to break down problems and reason through solutions
- experience_score: relevance and depth of prior experience relative to JD requirements
- role_alignment_score: motivation, cultural fit indicators, enthusiasm for the specific role
- overall_score: holistic assessment — NOT a simple average; weight by role importance

Recommendation guidelines:
- strong_hire: Exceptional candidate, clearly exceeds requirements, high confidence
- hire: Good candidate, meets requirements, recommend moving forward
- hold: Mixed signals, some concerns, may need additional evaluation
- no_hire: Does not meet requirements, or significant red flags observed

Be objective and evidence-based. Reference specific things said in the transcript.
If certain dimensions weren't assessable from the transcript, score conservatively (40-50) and note it.
"""


def _rubric_assessment_prompt(rubric: list[dict]) -> str:
    rubric_json = json.dumps(rubric, indent=2)
    has_expected = any(q.get("expected_points") for q in rubric)
    if has_expected:
        scoring_rules = """- For each question with expected_points, return point_coverage with one entry per expected point (same text, covered true/false)
- Use semantic matching: paraphrases and synonyms count as covered
- candidate_points: 3-8 concise bullets summarizing TECHNICAL content the candidate said for that question (from transcript)
- Do NOT award coverage for generic soft-skill statements unless they carry specific technical substance
- Do NOT return earned_score — scoring is computed from point_coverage"""
        question_shape = """{{ "id": "<rubric question id>", "candidate_points": ["..."], "point_coverage": [{{ "point": "<exact expected point text>", "covered": <true|false> }}], "notes": "<optional 1-line summary>", "candidate_answer": "<brief combined answer if helpful>" }}"""
    else:
        scoring_rules = """- earned_score must be an integer from 0 to the question's score (inclusive)
- overall_score MUST equal the sum of earned_score across all questions"""
        question_shape = """{{ "id": "<rubric question id>", "earned_score": <integer 0 to that question's score>, "notes": "<1-2 sentence justification>", "candidate_answer": "<what the candidate actually said in response — quote or faithful paraphrase from the transcript; empty string if not addressed>" }}"""

    return f"""You are an expert technical interviewer grading an interview transcript against a fixed rubric.

You will be given:
1. An interview transcript
2. The job description and candidate profile
3. A rubric of interview questions, each with an id, question text, point weight (score), and optional expected_points (answer key bullets)

For EACH rubric question, evaluate the candidate's response.
Return ONLY valid JSON with exactly these fields:

{{
  "question_scores": [
    {question_shape}
  ],
  "overall_score": <integer — sum of earned scores; use 0 as placeholder if using point_coverage>,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "jd_fit": "<2-3 sentences>",
  "final_recommendation": "<strong_hire | hire | hold | no_hire>",
  "summary": "<3-5 sentence executive summary>",
  "transcript_summary": "<2-3 sentence factual summary>"
}}

Rubric:
{rubric_json}

Rules:
{scoring_rules}
- If a question was not clearly addressed, mark all expected points as not covered and use empty candidate_points
- Grade only what the candidate said aloud; do not penalize for lacking written code (this is a voice interview)
- Evaluate technical substance only — stack knowledge, design decisions, debugging approach, tools, trade-offs
- Be objective and cite evidence from the transcript
"""


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
    import openai

    client = openai.AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
        temperature=0,
        max_tokens=3500,
    )
    return json.loads(response.choices[0].message.content)


def _build_user_content(transcript: str, job, candidate) -> str:
    required_skills_str = ", ".join(job.required_skills or []) or "Not specified"
    experience_range = f"{job.experience_min}–{job.experience_max} years"
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

    return f"""== JOB DESCRIPTION ==
Title: {job.title}
Required Skills: {required_skills_str}
Experience Required: {experience_range}
Description:
{job.description[:3000]}

== CANDIDATE PROFILE ==
Name: {candidate.name}
{candidate_summary}

== INTERVIEW TRANSCRIPT ==
{transcript[:14000]}
"""


async def generate_assessment(transcript: str, job, candidate, api_key: str) -> dict:
    """
    Generate a structured interview assessment using GPT-4o.
    Uses rubric-based scoring when job.interview_questions is set; otherwise legacy 0-100 dimensions.
    """
    import openai

    rubric = _normalize_rubric_questions(job.interview_questions)

    if not transcript or len(transcript.strip()) < MIN_TRANSCRIPT_LENGTH:
        logger.warning(
            "generate_assessment: transcript too short (%d chars) — returning needs_review",
            len(transcript) if transcript else 0,
        )
        return _build_needs_review_report(rubric if rubric else None)

    from app.services.mock_external import mock_interview_assessment, mock_openai_enabled

    if mock_openai_enabled():
        return mock_interview_assessment(transcript, job, candidate)

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
        report = _build_needs_review_report(rubric if rubric else None)
        report["summary"] = "Assessment failed due to authentication error. Manual review required."
        return report

    except Exception as exc:
        logger.error("generate_assessment failed: %s", exc)
        report = _build_needs_review_report(rubric if rubric else None)
        report["summary"] = f"Assessment failed: {type(exc).__name__}. Manual review required."
        return report
