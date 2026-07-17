"""Prompts for transcript-based interview assessment."""

import json

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


def build_rubric_assessment_prompt(rubric: list[dict]) -> str:
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


def build_assessment_user_prompt(
    *,
    job_title: str,
    required_skills: list[str],
    experience_min: int | None,
    experience_max: int | None,
    job_description: str,
    candidate_name: str,
    candidate_summary: str,
    transcript: str,
) -> str:
    skills = ", ".join(required_skills or []) or "Not specified"
    experience_range = f"{experience_min}–{experience_max} years"
    return f"""== JOB DESCRIPTION ==
Title: {job_title}
Required Skills: {skills}
Experience Required: {experience_range}
Description:
{job_description[:3000]}

== CANDIDATE PROFILE ==
Name: {candidate_name}
{candidate_summary}

== INTERVIEW TRANSCRIPT ==
{transcript[:14000]}
"""
