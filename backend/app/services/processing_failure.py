"""What HR is told when a resume could not be processed.

The raw error saved on the candidate (`pipeline_error`) is whatever exception text the pipeline
raised: it can carry file paths, provider messages or SQL. That stays on the single-candidate
detail response (which is audited). Lists and updates carry this short, plain sentence instead.
"""

from __future__ import annotations

import re

# First match wins, so the more specific causes come first. Matched against the raw error,
# case-insensitively.
_RULES: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(pattern, re.IGNORECASE), sentence)
    for pattern, sentence in (
        # Set by the worker itself, so they come first: the error they wrap may match a rule
        # below (a rate limit, say) whose advice no longer applies once retries ran out.
        (r"^retries exhausted",
         "The AI service could not be reached after several tries. Click Retry to try again."),
        (r"^stopped repeatedly",
         "The review kept stopping part way through. Click Retry, or re-upload the file."),
        # Before the rate-limit rule: OpenAI reports an empty account as a 429 too, but waiting
        # will not fix it.
        (r"insufficient_quota|exceeded your current quota",
         "The AI service account is out of credits. Ask an admin to check billing."),
        (r"duplicate candidate",
         "This candidate is already on this job (same email or phone). You can remove this copy."),
        (r"unsupported ?(document|file)",
         "This file could not be read. Re-upload it as a PDF or DOCX."),
        (r"no (readable |extractable )?text|empty document|could not extract|too short or empty",
         "No readable text was found in this resume. It may be a scanned image. "
         "Upload a text PDF or DOCX."),
        (r"filenotfound|no such file|file not found",
         "The uploaded file could not be found. Re-upload it."),
        (r"authenticationerror|incorrect api key|invalid api key|api[ _]key|integrations incomplete",
         "The AI service key is missing or invalid. Ask an admin to check it in Settings."),
        (r"notfounderror|model_not_found|does not exist or you do not have access",
         "The AI model is not available for this account."),
        (r"ratelimit|rate limit|quota",
         "The AI service is rate limited or out of quota. Try again later."),
        (r"job \S+ not found",
         "The job for this resume could not be found."),
    )
)

GENERIC = "The review failed. Try again, or re-upload the file."


def summarize_processing_failure(raw: str | None) -> str | None:
    """A safe one-line reason for a failed resume, or None when there was no failure."""
    if raw is None or not raw.strip():
        return None
    for pattern, sentence in _RULES:
        if pattern.search(raw):
            return sentence
    return GENERIC
