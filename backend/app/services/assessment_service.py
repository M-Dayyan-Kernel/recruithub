"""
Assessment Service — Sprint 6

GPT-4o powered interview assessment. Analyzes the interview transcript against
the job description and candidate profile to produce a structured scorecard.

Functions:
  - generate_assessment(transcript, job, candidate) → dict
"""

import json
import logging

from app.core.config import settings

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
    return f"""You are an expert technical interviewer grading an interview transcript against a fixed rubric.

You will be given:
1. An interview transcript
2. The job description and candidate profile
3. A rubric of interview questions, each with an id, question text, and point weight (score)

For EACH rubric question, score how well the candidate answered it.
Return ONLY valid JSON with exactly these fields:

{{
  "question_scores": [
    {{ "id": "<rubric question id>", "earned_score": <integer 0 to that question's score>, "notes": "<1-2 sentence justification>", "candidate_answer": "<what the candidate actually said in response — quote or faithful paraphrase from the transcript; empty string if not addressed>" }}
  ],
  "overall_score": <integer — sum of all earned_score values>,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "jd_fit": "<2-3 sentences>",
  "final_recommendation": "<strong_hire | hire | hold | no_hire>",
  "summary": "<3-5 sentence executive summary>",
  "transcript_summary": "<2-3 sentence factual summary>"
}}

Rubric (score each question 0 up to its score weight):
{rubric_json}

Rules:
- earned_score must be an integer from 0 to the question's score (inclusive)
- overall_score MUST equal the sum of earned_score across all questions
- If a question was not clearly addressed, score 0 and explain in notes
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
            {
                "id": q.get("id", ""),
                "question": q.get("question", ""),
                "score": int(q.get("score") or 0),
                "earned_score": None,
                "notes": "Not assessable — transcript too short.",
                "candidate_answer": "",
            }
            for q in rubric
        ]
    return report


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
        })
    return [q for q in normalized if q["score"] > 0]


def _merge_rubric_scores(rubric: list[dict], gpt_scores: list[dict]) -> list[dict]:
    by_id = {str(s.get("id")): s for s in gpt_scores if isinstance(s, dict)}
    merged = []
    total_earned = 0
    for q in rubric:
        qid = str(q.get("id") or "")
        gpt = by_id.get(qid, {})
        max_score = int(q.get("score") or 0)
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
        })
    return merged, total_earned


async def _run_gpt_assessment(system_prompt: str, user_content: str) -> dict:
    import openai

    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
        temperature=0,
        max_tokens=2000,
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


async def generate_assessment(transcript: str, job, candidate) -> dict:
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

    user_content = _build_user_content(transcript, job, candidate)

    try:
        if rubric:
            system_prompt = _rubric_assessment_prompt(rubric)
            result = await _run_gpt_assessment(system_prompt, user_content)
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
            result = await _run_gpt_assessment(ASSESSMENT_SYSTEM_PROMPT, user_content)
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
