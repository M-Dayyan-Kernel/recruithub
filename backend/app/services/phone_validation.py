"""
Phone Validation Service — Sprint 5

Validates and normalises phone numbers to E.164 format for Vapi outbound calls.
When geography enforcement is enabled, only allowed regions (default +91 India) pass.
"""

from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.settings_service import load_system_settings


def _strip_digits(phone: str) -> str:
    return re.sub(r"[^\d]", "", phone)


def _normalize_indian(digits: str) -> tuple[bool, str]:
    if digits.startswith("91") and len(digits) == 12:
        return True, f"+{digits}"
    if len(digits) == 10:
        return True, f"+91{digits}"
    return False, ""


def validate_phone_sync(
    phone: str,
    *,
    enforce_geography: bool,
    allowed_regions: list[str],
) -> tuple[bool, str, str | None]:
    """
    Validate and normalise a phone number.

    Returns (is_valid, normalized_e164, reject_reason).
    """
    if not phone:
        return False, "", "No phone number on file"

    digits = _strip_digits(phone)
    if len(digits) < 10:
        return False, "", "Invalid phone number"

    if enforce_geography and "IN" in allowed_regions:
        ok, normalized = _normalize_indian(digits)
        if not ok:
            return False, "", "Phone number not in allowed region (+91 only)"
        return True, normalized, None

    # Geography not enforced — accept 10+ digit numbers with + prefix
    stripped = phone.strip()
    if stripped.startswith("+"):
        return True, f"+{digits}", None
    if len(digits) == 10:
        return True, f"+91{digits}", None
    if len(digits) >= 10:
        return True, f"+{digits}", None

    return False, "", "Invalid phone number"


async def validate_phone(
    phone: str,
    *,
    session: AsyncSession | None = None,
    tenant_id=None,
) -> tuple[bool, str]:
    """
    Validate and normalise a phone number using current tenant settings.

    Returns:
        (True, "+919876543210")  — valid number, normalised
        (False, "")              — invalid number
    """
    settings = await load_system_settings(session, tenant_id=tenant_id)
    is_valid, normalized, _reason = validate_phone_sync(
        phone,
        enforce_geography=settings.enforce_phone_geography,
        allowed_regions=settings.allowed_phone_regions,
    )
    return is_valid, normalized


async def validate_phone_with_reason(
    phone: str,
    *,
    session: AsyncSession | None = None,
    tenant_id=None,
) -> tuple[bool, str, str | None]:
    """Like validate_phone but includes human-readable reject reason."""
    settings = await load_system_settings(session, tenant_id=tenant_id)
    return validate_phone_sync(
        phone,
        enforce_geography=settings.enforce_phone_geography,
        allowed_regions=settings.allowed_phone_regions,
    )
