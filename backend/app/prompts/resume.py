"""Prompts for resume parsing."""

PROMPT_VERSION = "resume-parse-v1"

PARSE_SYSTEM_PROMPT = """You are a resume parser. Extract structured information from the resume text provided.
Return ONLY valid JSON with exactly these fields:
- name: string (candidate's full name)
- email: string (email address)
- phone: string (phone number with country code if present)
- skills: array of strings (all technical skills, tools, languages, frameworks mentioned)
- total_experience_years: number (float, total professional experience in years)
- experience: array of objects with {company: string, title: string, duration: string, description: string}
- education: array of objects with {institution: string, degree: string, field: string, year: string}
- current_company: string (most recent employer name)
- current_role: string (most recent job title)
If any field cannot be found in the resume, use null for that field.
Skills must be a flat array of individual skill strings (e.g. ["Python", "React", "PostgreSQL"])."""


def build_parse_user_prompt(resume_text: str) -> str:
    return f"Parse this resume and return structured JSON:\n\n{resume_text}"
