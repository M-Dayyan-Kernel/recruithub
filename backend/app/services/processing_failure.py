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
        (r"unsupported ?(document|file)",
         "This file could not be read. Re-upload it as a PDF or DOCX."),
        (r"no (readable |extractable )?text|empty document|could not extract",
         "No readable text was found in this resume. It may be a scanned image."),
        (r"filenotfound|no such file|file not found",
         "The uploaded file could not be found. Re-upload it."),
        (r"authenticationerror|incorrect api key|invalid api key|api key",
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
