"""Resolve and normalize candidate contact fields."""

from __future__ import annotations

import re

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


def normalize_email(email: str | None) -> str | None:
    if not email:
        return None
    value = email.strip().lower()
    if not value or value.endswith("@upload.pending"):
        return None
    return value


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 7:
        return None
    return digits
