"""Prompts for candidate shortlisting."""

import json

PROMPT_VERSION = "shortlist-v1"

SHORTLIST_SYSTEM_PROMPT = (
    "You are an expert recruiter assessing candidate-JD fit. "
    "Analyse the candidate profile against the job description and return "
    "a structured JSON assessment with these exact keys:\n"
    "  match_score: integer 0-100 (overall fit percentage)\n"
    "  recommendation: one of 'shortlisted' | 'rejected' | 'review'\n"
    "  strengths: array of 2-5 short strings (candidate's matching strengths)\n"
    "  gaps: array of 0-5 short strings (missing skills or experience gaps)\n"
    "  reason: string, 1-2 sentences explaining the recommendation\n\n"
    "Scoring guide:\n"
    "  80-100 → shortlisted (strong match)\n"
    "  50-79  → review (partial match, HR should decide)\n"
    "  0-49   → rejected (poor fit)\n\n"
    "Base your score on skill and experience fit against the job requirements."
)


def build_shortlist_user_prompt(
    job_summary: dict,
    candidate_summary: dict,
) -> str:
    return (
        f"Job Description:\n{json.dumps(job_summary, indent=2)}\n\n"
        f"Candidate Profile:\n{json.dumps(candidate_summary, indent=2)}\n\n"
        "Return the JSON assessment."
    )
