"""Prompts for job-description parsing and question generation."""

from app.prompts.common import (
    DIFFICULTY_TIER_GUIDANCE,
    TECHNICAL_ONLY_PROMPT_RULES,
)

PARSE_JD_SYSTEM_PROMPT = f"""You are a job description parser. Extract structured information from the job description text provided.
Return ONLY valid JSON with exactly these fields:
- title: string (job title)
- description: string (full role description — responsibilities, requirements, and context combined into readable prose)
- required_skills: array of strings (individual technical skills, tools, languages, frameworks mentioned)
- experience_min: number or null (minimum years of experience required, if stated)
- experience_max: number or null (maximum years of experience required, if stated)
- work_mode: one of "remote", "hybrid", "onsite", or null. Use it ONLY if the job description states how the work is done (e.g. "work from office", "WFO", "hybrid", "remote", "work from home"). If it does not say, use null — do not guess.
- work_location: string or null. The city or office location where a hybrid or on-site role is based, if stated. null for a remote role or when not stated.
- screening_questions: array of EXACTLY 2 objects, each with {{ "id": "<uuid string>", "question": "<screening question text>" }}
  Generate exactly 2 role-specific phone screening questions about must-haves from the JD (skills, certifications, domain experience, work authorization, etc.). Keep each under 180 characters.
  Do NOT cover availability, notice period, current employment, CTC or salary, work location or remote/hybrid/on-site preference, or years of experience: those are asked separately.
  Each question must have a unique id (UUID string).
- interview_questions: array of objects, each with {{ "id": "<uuid string>", "question": "<interview question text>", "score": <positive integer> }}
  Generate 4-6 role-relevant TECHNICAL interview questions only (stack, architecture, debugging, system design, tools, trade-offs).
  Calibrate question depth to experience_min/experience_max and job title (junior fundamentals, mid applied design, senior system design).
  Point weights (score field) must sum to approximately 100 across all questions.
  Each question must have a unique id (UUID string).
  Do NOT generate behavioural, culture-fit, motivation-only, or soft-skill questions (no conflict stories, leadership style, strengths/weaknesses).
  Do NOT include "tell me about yourself" in the rubric.

{TECHNICAL_ONLY_PROMPT_RULES}

{DIFFICULTY_TIER_GUIDANCE}

VOICE-ONLY: This is a spoken interview with no code editor or compiler. Every question must be answerable by talking (explain, describe experience, walk through approach). Do NOT generate live coding, "write a function", coding exercises, whiteboard implementation, or screen-share tasks.
If experience is given as a single number (e.g. "5+ years"), set experience_min to that number and experience_max to null.
required_skills must be a flat array of individual skill strings (e.g. ["Python", "React", "PostgreSQL"]).
Use null for fields that cannot be determined from the document. Use empty array for interview_questions if none can be inferred."""


def build_parse_jd_user_prompt(job_description_text: str) -> str:
    return (
        "Parse this job description and return structured JSON:\n\n"
        f"{job_description_text}"
    )
