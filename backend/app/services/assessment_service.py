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

# Minimum transcript length to attempt a real assessment
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


def _build_needs_review_report() -> dict:
    """Return a default report when transcript is too short to assess."""
    return {
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
    }


async def generate_assessment(transcript: str, job, candidate) -> dict:
    """
    Generate a structured interview assessment using GPT-4o.

    Args:
        transcript: Full interview transcript text
        job: Job ORM model instance (has .title, .description, .required_skills, etc.)
        candidate: Candidate ORM model instance (has .name, .parsed_data, etc.)

    Returns:
        dict with all scorecard fields. Never raises — returns needs_review on failure.
    """
    import openai

    # Guard: insufficient transcript
    if not transcript or len(transcript.strip()) < MIN_TRANSCRIPT_LENGTH:
        logger.warning(
            "generate_assessment: transcript too short (%d chars) — returning needs_review",
            len(transcript) if transcript else 0,
        )
        return _build_needs_review_report()

    # Build context for the prompt
    required_skills_str = ", ".join(job.required_skills or []) or "Not specified"
    experience_range = f"{job.experience_min}–{job.experience_max} years"
    candidate_summary = ""
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

    user_content = f"""== JOB DESCRIPTION ==
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

    try:
        client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": ASSESSMENT_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=1500,
        )

        raw_content = response.choices[0].message.content
        result = json.loads(raw_content)

        # Validate required keys are present; fill missing ones defensively
        required_keys = [
            "technical_fit_score", "communication_score", "problem_solving_score",
            "experience_score", "role_alignment_score", "overall_score",
            "strengths", "weaknesses", "jd_fit", "final_recommendation",
            "summary", "transcript_summary",
        ]
        for key in required_keys:
            if key not in result:
                result[key] = 0 if "score" in key else ("needs_review" if key == "final_recommendation" else "")

        logger.info(
            "Assessment generated for candidate=%s job=%s overall_score=%s recommendation=%s",
            candidate.name,
            job.title,
            result.get("overall_score"),
            result.get("final_recommendation"),
        )
        return result

    except openai.AuthenticationError as exc:
        logger.error("OpenAI auth error during assessment: %s", exc)
        report = _build_needs_review_report()
        report["summary"] = "Assessment failed due to authentication error. Manual review required."
        return report

    except Exception as exc:
        logger.error("generate_assessment failed: %s", exc)
        report = _build_needs_review_report()
        report["summary"] = f"Assessment failed: {type(exc).__name__}. Manual review required."
        return report
