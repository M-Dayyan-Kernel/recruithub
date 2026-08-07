"""Server-side screening disposition for the talentos integration.

Computes the same "pending / completed / flagged" classification that the POC
HR-app derives client-side in screeningRows.ts (classifyTab) so talentOS can
consume a stable disposition without touching any POC core code.

This module lives entirely inside the talentos integration module. It only
*reads* from POC core services (phone validation) — no POC core file is
modified.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from app.models.models import Candidate, ScreeningCall
from app.services.phone_validation import validate_phone_sync

logger = logging.getLogger(__name__)

# "pending" | "completed" | "flagged"
ScreeningDisposition = str

LIVE_CALL_STATUSES = frozenset({"initiated", "in_progress"})
CONNECT_FAILURE_OUTCOMES = frozenset({"no_answer", "voicemail", "dropped", "busy", "transport_error", "call_failed"})
MIN_SUBSTANTIVE_TRANSCRIPT_CHARS = 50

_FLAG_NO_PHONE = "No phone number on file"
_FLAG_NOT_ALLOWED_REGION = "Phone number not in allowed region (+91 only)"
_FLAG_DECLINED = "Candidate declined the call"
_FLAG_MAX_ATTEMPTS = "Unable to connect after maximum attempts"


def is_scheduled_retry(call: ScreeningCall) -> bool:
    """A 'pending' row that is queued for an automatic redial (no live call)."""
    return call.call_status == "pending" and not call.vapi_call_id


def _is_live_call(call: ScreeningCall) -> bool:
    return call.call_status in LIVE_CALL_STATUSES


def is_successful_screening_call(call: ScreeningCall) -> bool:
    """A call where the candidate was actually reached and screened."""
    if call.call_status != "completed":
        return False
    if call.call_outcome == "completed":
        return True
    if call.result in ("pass", "fail"):
        return True
    if call.result == "needs_review":
        return bool((call.transcript or "").strip())
    transcript = (call.transcript or "").strip()
    return len(transcript) > MIN_SUBSTANTIVE_TRANSCRIPT_CHARS


def _technical_failure_reason(call: ScreeningCall) -> str:
    if call.summary:
        return call.summary
    if call.ended_reason:
        return f"Call failed before connecting ({call.ended_reason}). Check Vapi/Twilio configuration."
    return "Call could not connect (technical failure). Check Vapi phone number and Twilio settings."


def _phone_flag_reason(
    phone: Optional[str],
    *,
    enforce_geography: bool,
    allowed_regions: List[str],
) -> Optional[str]:
    """Flag reason for phone-level issues, or None when the phone is acceptable."""
    if not phone:
        return _FLAG_NO_PHONE
    if not enforce_geography:
        return None
    ok, _normalized, _reason = validate_phone_sync(
        phone,
        enforce_geography=True,
        allowed_regions=list(allowed_regions),
    )
    if not ok:
        return _FLAG_NOT_ALLOWED_REGION
    return None


def classify_screening_disposition(
    call: Optional[ScreeningCall],
    phone: Optional[str],
    *,
    enforce_phone_geography: bool,
    allowed_phone_regions: List[str],
    screening_max_retries: int,
) -> Tuple[ScreeningDisposition, Optional[str]]:
    """Classify a candidate's screening state into pending/completed/flagged.

    Mirrors screeningRows.ts -> classifyTab(). Returns (disposition, flag_reason).
    """
    flag_reason = _phone_flag_reason(
        phone,
        enforce_geography=enforce_phone_geography,
        allowed_regions=allowed_phone_regions,
    )
    if flag_reason is not None:
        return "flagged", flag_reason

    if call is None:
        return "pending", None

    if (call.call_outcome or "").lower() == "declined":
        return "flagged", _FLAG_DECLINED

    if call.call_status == "failed" or (call.call_outcome or "").lower() == "failed":
        return "flagged", _technical_failure_reason(call)

    max_attempts = max(int(screening_max_retries or 0), 1)

    if _is_live_call(call) or is_scheduled_retry(call) or call.call_status == "pending":
        return "pending", None

    # Successful contact — check before connect-failure exhaustion so an answered
    # retry is not flagged when call_outcome is still no_answer from an early webhook.
    if is_successful_screening_call(call):
        return "completed", None

    if (call.call_outcome or "").lower() in CONNECT_FAILURE_OUTCOMES:
        if (call.retry_count or 0) >= max_attempts - 1:
            # Audit-trail grace window — a just-recorded exhausted dial stays pending briefly.
            if (call.retry_count or 0) > 0 and _age_millis(call) < 25_000:
                return "pending", None
            return "flagged", _FLAG_MAX_ATTEMPTS
        return "pending", None

    if call.call_status == "completed" and (
        call.call_outcome == "completed"
        or call.result in ("pass", "fail", "needs_review")
        or bool((call.transcript or "").strip())
    ):
        return "completed", None

    return "pending", None


def _age_millis(call: ScreeningCall) -> float:
    try:
        now = datetime.now(timezone.utc)
        created = call.created_at
        if created is None:
            return 0.0
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return (now - created).total_seconds() * 1000.0
    except Exception:
        return 0.0


def classify_for_candidate(
    candidate: Candidate,
    call: Optional[ScreeningCall],
    settings,
) -> Tuple[ScreeningDisposition, Optional[str]]:
    """Convenience wrapper reading the phone from the candidate + a settings object."""
    return classify_screening_disposition(
        call,
        (candidate.phone or "").strip() or None,
        enforce_phone_geography=bool(settings.enforce_phone_geography),
        allowed_phone_regions=list(settings.allowed_phone_regions),
        screening_max_retries=settings.screening_max_retries,
    )
