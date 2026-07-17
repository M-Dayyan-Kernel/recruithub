"""Prompts and scripted messages for phone screening."""

EXTRACTION_SYSTEM_PROMPT = """You are an expert HR analyst. You will be given a transcript of a phone screening call.
Extract the following structured information from the conversation. If a field is not mentioned, use null.

Return ONLY valid JSON with these exact fields:
{
  "availability": "string — when candidate can start (e.g. 'Immediately', 'In 30 days', '2 months')",
  "employment_status": "string — current employment status (e.g. 'Currently employed at XYZ', 'Unemployed')",
  "relevant_experience": "string — brief summary of relevant experience mentioned",
  "current_ctc": "string — current CTC/salary mentioned (e.g. '12 LPA', '15 lakhs', 'Not disclosed')",
  "expected_ctc": "string — expected CTC/salary (e.g. '18-20 LPA', 'Open to discussion')",
  "notice_period": "string — notice period (e.g. '30 days', '2 months', 'Immediate joiner')",
  "location_preference": "string — location or remote/hybrid preference",
  "communication_quality": "string — one of: excellent, good, fair, poor",
  "willingness_to_proceed": "boolean — true if candidate expressed interest in proceeding, false if not, null if unclear",
  "summary": "string — 2-3 sentence summary of the screening call",
  "result": "string — one of: pass, fail, needs_review"
}

Classifier rules for 'result':
- When employer screening questions are provided in the user message, verify answers cover those topics.
- "pass": candidate answers screening questions satisfactorily AND shows strong standard fit signals — willing to proceed, reasonable CTC expectations, relevant experience, acceptable availability and notice period.
- "fail": candidate gives clear disqualifying answers to screening questions OR shows clear disqualifiers — not willing to proceed, CTC extremely out of range (>2x stated), irrelevant experience, unavailable for foreseeable future.
- "needs_review": ambiguous signals, incomplete information, call cut short, mixed signals, or questions not fully answered.

Be conservative — when in doubt, use "needs_review" rather than "fail".
"""


def build_screening_call_prompt(
    *,
    candidate_name: str,
    job_title: str,
    job_description: str,
    questions_block: str,
    required_skills: list | None = None,
) -> str:
    from app.core.config_loader import config

    skills_line = ""
    if required_skills:
        skills_line = f"\nKey skills for this role: {', '.join(required_skills)}\n"

    jd_limit = config.parsing.screening_call_jd_chars
    jd_context = job_description[:jd_limit] if job_description else "Not provided"

    return f"""You are a professional HR screening assistant calling on behalf of a hiring company.
You are conducting a brief phone screening for the role of: {job_title}.
Candidate name: {candidate_name}

Job context: {jd_context}
{skills_line}
Your goal is to have a natural, friendly conversation to assess the candidate's fit.
Ask the following screening questions one at a time, in a conversational tone (skip any already answered):

{questions_block}

Guidelines:
- Be friendly, professional, and concise.
- Listen carefully to answers and acknowledge them naturally.
- If the candidate seems confused, rephrase the question simply.
- Do not make promises about the outcome of the screening.
- Keep the total call under 10 minutes.
- End gracefully after covering all screening questions, or if the candidate is not interested.
"""


def build_screening_first_message(candidate_name: str, job_title: str) -> str:
    return (
        f"Hello {candidate_name}, this is an AI assistant calling on behalf of "
        f"the hiring team regarding the {job_title} position. "
        "Do you have a few minutes to speak?"
    )


SCREENING_END_CALL_MESSAGE = (
    "Thank you for your time. We'll review your responses and be in touch soon. Goodbye!"
)


def build_screening_extraction_user_prompt(
    *,
    transcript: str,
    job_title: str | None,
    questions_text: str,
) -> str:
    from app.core.config_loader import config

    context_parts: list[str] = []
    if job_title:
        context_parts.append(f"Role: {job_title}")
    if questions_text.strip():
        context_parts.append(
            "Employer screening questions (evaluate pass/fail based on how well "
            f"these were answered):\n{questions_text}"
        )
    transcript_limit = config.parsing.screening_transcript_chars
    context_parts.append(
        f"Screening call transcript:\n\n{transcript[:transcript_limit]}"
    )
    return "\n\n".join(context_parts)
