"""Prompts for combined resume profile extraction + JD shortlisting."""

import json

PROMPT_VERSION = "combined-shortlist-v1"

COMBINED_SHORTLIST_SYSTEM_PROMPT = """You are an expert recruiter. From the resume text and job description provided:
1. Extract a structured candidate profile (contact info, skills, experience, education).
2. Assess candidate-JD fit and return a shortlist assessment.

Return ONLY valid JSON with exactly these top-level keys:
  profile: object with keys:
    name, email, phone (strings or null)
    skills: array of strings
    total_experience_years: number
    experience: array of {company, title, duration, description}
    education: array of {institution, degree, field, year}
    current_company, current_role (strings or null)
  assessment: object with keys:
    match_score: integer 0-100
    recommendation: one of 'shortlisted' | 'rejected' | 'review'
    strengths: array of 2-5 short strings
    gaps: array of 0-5 short strings
    reason: string, 1-2 sentences

Scoring guide:
  80-100 → shortlisted (strong match)
  50-79  → review (partial match)
  0-49   → rejected (poor fit)

Base the assessment on skill and experience fit against the job requirements."""


def build_combined_shortlist_user_prompt(
    resume_text: str,
    job_summary: dict,
) -> str:
    return (
        f"Job Description:\n{json.dumps(job_summary, indent=2)}\n\n"
        f"Resume Text:\n{resume_text}\n\n"
        "Return the combined JSON with profile and assessment."
    )
