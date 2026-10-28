"""Phone-screening questions: the locked standard set, the derived location question, and the
rules for the questions HR and the JD parser add.

A job's list is always the standard questions first, then up to MAX_SCREENING_QUESTIONS minus
those: the AI-generated "role" questions and any "custom" ones HR adds. The standard ones are
built here from the job's title, work mode and location every time they are needed, so a client
can neither edit nor remove them and a renamed job never reaches a call with stale text.
"""

import uuid
from typing import Any, Iterable, Optional

#: Total questions on one call, standard ones included. Mirrored in hr-app/src/lib/validation.ts.
MAX_SCREENING_QUESTIONS = 10
#: Per question the AI or HR writes (the standard ones are exempt). Mirrored in the web client.
MAX_SCREENING_QUESTION_CHARS = 200
#: The JD parser's role-specific questions per job.
ROLE_QUESTION_COUNT = 2
#: The work location is interpolated into the voice prompt, so it stays short and one line.
MAX_WORK_LOCATION_CHARS = 80

WORK_MODES = ("remote", "hybrid", "onsite")
QUESTION_KINDS = ("standard", "role", "custom")

#: Every standard question's id starts with this; a client row carrying it is never kept.
STANDARD_ID_PREFIX = "screening-default-"
LOCATION_QUESTION_ID = "screening-default-location"

_STANDARD_TEMPLATES: list[tuple[str, str]] = [
    (
        "screening-default-availability",
        "When are you available to start? If you are serving a notice period, "
        "please tell me how long.",
    ),
    (
        "screening-default-employment",
        "Are you currently employed? What is your current role and company?",
    ),
    (
        "screening-default-experience",
        "Can you briefly describe your most relevant experience for this {job_title} role?",
    ),
    (
        "screening-default-current-ctc",
        "What is your current compensation package (annual CTC)?",
    ),
    (
        "screening-default-expected-ctc",
        "What are your salary expectations for this role?",
    ),
]

_LOCATION_TEMPLATES = {
    "onsite": (
        "This role is work from office in {location}. "
        "Are you comfortable working from this location?"
    ),
    "hybrid": (
        "This role is hybrid and based in {location}. "
        "Are you comfortable with the hybrid arrangement and working from there?"
    ),
    "remote": "This role is fully remote. Are you comfortable working remotely?",
}

#: A job created before work modes existed has none; this is what it was always asked.
_LEGACY_LOCATION_QUESTION = "What is your remote, hybrid, or on-site preference?"

_WORK_MODE_ALIASES = {
    "remote": "remote",
    "work from home": "remote",
    "wfh": "remote",
    "hybrid": "hybrid",
    "onsite": "onsite",
    "on-site": "onsite",
    "on site": "onsite",
    "office": "onsite",
    "in-office": "onsite",
    "in office": "onsite",
    "work from office": "onsite",
    "wfo": "onsite",
}


def parse_work_mode(raw: Any) -> Optional[str]:
    """A work mode from model output or a loosely typed client, else None. Never guesses."""
    if not isinstance(raw, str):
        return None
    return _WORK_MODE_ALIASES.get(" ".join(raw.lower().split()))


def clean_work_location(raw: Any) -> Optional[str]:
    """One trimmed line, or None when there is nothing left."""
    if not isinstance(raw, str):
        return None
    cleaned = " ".join(raw.split())
    return cleaned or None


def validate_work_location(work_mode: Optional[str], work_location: Any) -> Optional[str]:
    """The location to store for this mode. Raises ValueError when it cannot be used.

    Hybrid and on-site jobs need one; a remote job has none, so any given is dropped.
    """
    location = clean_work_location(work_location)
    if work_mode == "remote":
        return None
    if location is not None and len(location) > MAX_WORK_LOCATION_CHARS:
        raise ValueError(f"Work location must be at most {MAX_WORK_LOCATION_CHARS} characters")
    if work_mode in ("hybrid", "onsite") and location is None:
        raise ValueError("Work location is required for hybrid and on-site jobs")
    return location


def location_question(work_mode: Optional[str], work_location: Optional[str]) -> str:
    template = _LOCATION_TEMPLATES.get(work_mode or "")
    if template is None:
        return _LEGACY_LOCATION_QUESTION
    if work_mode != "remote":
        location = clean_work_location(work_location)
        if location is None:
            return _LEGACY_LOCATION_QUESTION
        return template.replace("{location}", location)
    return template


def build_standard_questions(
    title: Optional[str],
    work_mode: Optional[str] = None,
    work_location: Optional[str] = None,
) -> list[dict]:
    """The locked questions for a job: five fixed ones, then the location question.

    Values are substituted with str.replace, not str.format: a title or location may hold braces.
    """
    job_title = " ".join((title or "").split()) or "this"
    rows = [
        {"id": qid, "question": text.replace("{job_title}", job_title), "kind": "standard"}
        for qid, text in _STANDARD_TEMPLATES
    ]
    rows.append(
        {
            "id": LOCATION_QUESTION_ID,
            "question": location_question(work_mode, work_location),
            "kind": "standard",
        }
    )
    return rows


def _editable_rows(items: Optional[Iterable[Any]], *, strict: bool) -> list[dict]:
    """The role and custom rows of a submitted or stored list, cleaned.

    Standard rows (by id) and the retired ones are dropped, an unknown kind becomes custom, and
    repeated text is kept once. Strict is for what a client submits: blank or over-long text is an
    error. Lenient is for what is already stored, which may predate the limits and must stay
    readable.
    """
    rows: list[dict] = []
    seen: set[str] = set()
    for index, item in enumerate(items or [], start=1):
        if not isinstance(item, dict):
            item = item.model_dump() if hasattr(item, "model_dump") else None
        if item is None:
            continue
        qid = str(item.get("id") or "")
        if qid.startswith(STANDARD_ID_PREFIX) or item.get("kind") == "standard":
            continue
        text = " ".join(str(item.get("question") or "").split())
        if not text:
            if strict:
                raise ValueError(f"Screening question {index} is empty")
            continue
        if strict and len(text) > MAX_SCREENING_QUESTION_CHARS:
            raise ValueError(
                f"Screening question {index} is over {MAX_SCREENING_QUESTION_CHARS} characters"
            )
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        kind = item.get("kind") if item.get("kind") in ("role", "custom") else "custom"
        rows.append({"id": qid or str(uuid.uuid4()), "question": text, "kind": kind})
    return rows


def normalize_screening_questions_for_write(
    submitted: Optional[Iterable[Any]],
    *,
    title: Optional[str],
    work_mode: Optional[str],
    work_location: Optional[str],
    strict: bool = True,
) -> list[dict]:
    """The list to store: the standard questions, then the submitted role and custom ones."""
    standard = build_standard_questions(title, work_mode, work_location)
    editable = _editable_rows(submitted, strict=strict)
    if strict and len(standard) + len(editable) > MAX_SCREENING_QUESTIONS:
        raise ValueError(
            f"A job can have at most {MAX_SCREENING_QUESTIONS} screening questions; "
            f"{len(standard)} are standard, so {MAX_SCREENING_QUESTIONS - len(standard)} can be added"
        )
    return standard + editable


def effective_screening_questions(job: Any) -> list[dict]:
    """What a call asks for this job, whatever its stored list holds.

    Recomposed on every read: a legacy list (no kinds, editable defaults, the retired notice and
    interest questions) comes out in the same shape as a new one, and a renamed job or a changed
    location is never stale.
    """
    return normalize_screening_questions_for_write(
        getattr(job, "screening_questions", None),
        title=getattr(job, "title", None),
        work_mode=getattr(job, "work_mode", None),
        work_location=getattr(job, "work_location", None),
        strict=False,
    )


def normalize_role_questions(raw: Optional[Iterable[Any]]) -> list[dict]:
    """The JD parser's questions, ready to offer: blank, over-long and repeated ones dropped, at
    most ROLE_QUESTION_COUNT kept. An over-long one is dropped, not cut, since a cut question
    can stop making sense."""
    kept: list[dict] = []
    seen = {row["question"].lower() for row in build_standard_questions(None)}
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        text = " ".join(str(item.get("question") or "").split())
        key = text.lower()
        if not text or len(text) > MAX_SCREENING_QUESTION_CHARS or key in seen:
            continue
        seen.add(key)
        qid = str(item.get("id") or "")
        if not qid or qid.startswith(STANDARD_ID_PREFIX):
            qid = str(uuid.uuid4())
        kept.append({"id": qid, "question": text, "kind": "role"})
        if len(kept) == ROLE_QUESTION_COUNT:
            break
    return kept


def format_screening_questions_for_prompt(questions: Optional[Iterable[Any]]) -> str:
    """The numbered list the voice agent and the extraction prompt read."""
    lines = []
    number = 0
    for q in questions or []:
        if not isinstance(q, dict):
            continue
        text = " ".join(str(q.get("question") or "").split())
        if text:
            number += 1
            lines.append(f"{number}. {text}")
    return "\n".join(lines)
