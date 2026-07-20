"""
Phone Validation Service — Sprint 5

Validates and normalises phone numbers to E.164 format for Vapi outbound calls.
When geography enforcement is enabled, numbers must match an allowed region
dialing code (default +91 India).
"""

from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.settings_service import load_system_settings

# ISO 3166-1 alpha-2 → E.164 country calling code (no leading +).
REGION_DIAL_CODES: dict[str, str] = {
    "IN": "91",
    "US": "1",
    "CA": "1",
    "GB": "44",
    "AU": "61",
    "AE": "971",
    "SG": "65",
    "MY": "60",
    "PH": "63",
    "ID": "62",
    "TH": "66",
    "VN": "84",
    "NP": "977",
    "BD": "880",
    "LK": "94",
    "PK": "92",
    "SA": "966",
    "QA": "974",
    "KW": "965",
    "OM": "968",
    "BH": "973",
    "DE": "49",
    "FR": "33",
    "NL": "31",
    "IE": "353",
    "NZ": "64",
    "ZA": "27",
    "NG": "234",
    "KE": "254",
}


def _strip_digits(phone: str) -> str:
    return re.sub(r"[^\d]", "", phone)


def _allowed_dial_codes(allowed_regions: list[str]) -> list[str]:
    codes: list[str] = []
    seen: set[str] = set()
    for region in allowed_regions or []:
        code = REGION_DIAL_CODES.get(str(region).upper().strip())
        if code and code not in seen:
            seen.add(code)
            codes.append(code)
    return codes


def _match_allowed_code(digits: str, dial_codes: list[str]) -> tuple[bool, str]:
    """Longest-prefix match against allowed dialing codes."""
    for code in sorted(dial_codes, key=len, reverse=True):
        if digits.startswith(code) and len(digits) > len(code):
            return True, f"+{digits}"
        # Local national number without country code (India 10-digit special case)
        if code == "91" and len(digits) == 10:
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

    if enforce_geography:
        dial_codes = _allowed_dial_codes(allowed_regions)
        if not dial_codes:
            return False, "", "No allowed phone regions configured"
        ok, normalized = _match_allowed_code(digits, dial_codes)
        if not ok:
            regions = ", ".join(sorted({r.upper() for r in allowed_regions if r}))
            return (
                False,
                "",
                f"Phone number not in allowed region(s): {regions or 'unknown'}",
            )
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
