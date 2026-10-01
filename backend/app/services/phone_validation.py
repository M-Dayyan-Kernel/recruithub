"""
Phone Validation Service — Sprint 5

Validates and normalises phone numbers to E.164 format for Vapi outbound calls.
Focuses on Indian numbers (91 country code) but accepts any 10+ digit number.
"""

import re


def validate_phone(phone: str) -> tuple[bool, str]:
    """
    Validate and normalise a phone number to E.164 format.

    Returns:
        (True, "+919876543210")  — valid number, normalised
        (False, "")              — invalid number

    Rules:
    - Strip +, spaces, dashes, parentheses
    - Must have 10+ digits after stripping
    - Indian numbers:
        - 12 digits starting with 91 → already includes country code → "+91XXXXXXXXXX"
        - 10 digits → prepend +91 → "+91XXXXXXXXXX"
    - Other numbers: prepend "+" if not already present
    """
    if not phone:
        return False, ""

    # Strip all non-digit characters (except leading + which we handle separately)
    digits = re.sub(r"[^\d]", "", phone)

    if len(digits) < 10:
        return False, ""

    # Indian number: starts with 91 and is exactly 12 digits
    if digits.startswith("91") and len(digits) == 12:
        return True, f"+{digits}"

    # Indian number: exactly 10 digits (bare mobile number)
    if len(digits) == 10:
        return True, f"+91{digits}"

    # Any other number with 10+ digits — prepend + if needed
    # (handles non-Indian numbers like +1-555-123-4567 → stripped to 11 digits)
    if len(digits) >= 10:
        # If original phone had a leading +, trust the country code is included
        stripped = phone.strip()
        if stripped.startswith("+"):
            return True, f"+{digits}"
        else:
            # No leading +: ambiguous — still accept but return as-is with +
            return True, f"+{digits}"

    return False, ""
