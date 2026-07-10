"""Resolve candidate contact fields from parsed resume data or stored columns."""

from __future__ import annotations

from app.models.models import Candidate


def resolve_candidate_email(candidate: Candidate | None) -> str | None:
    if not candidate:
        return None
    parsed = candidate.parsed_data or {}
    raw_email = parsed.get("email") or candidate.email
    if not raw_email or str(raw_email).endswith("@upload.pending"):
        return None
    return str(raw_email)


def resolve_candidate_name(candidate: Candidate | None) -> str:
    if not candidate:
        return "Candidate"
    parsed = candidate.parsed_data or {}
    return str(parsed.get("name") or candidate.name or "Candidate")
