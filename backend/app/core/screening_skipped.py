"""A screening call that never happened.

Moving a candidate to the interview without a call writes a completed/pass row so the
interview gates keep working. Readers that mean "a call took place" must not count it.
New rows carry `ended_reason='skipped'`; rows written before that marker are recognised by
the summary the writers used. A completed pass with no Vapi id alone is NOT enough: the
proctoring demo seed and test fixtures create those on purpose.
"""

from __future__ import annotations

from typing import Optional

SKIPPED_ENDED_REASON = "skipped"

# Summaries written by the three bypass paths before the marker existed.
_LEGACY_SKIP_SUMMARY_PREFIXES = (
    "Screening bypassed",
    "Voice screening was turned off",
    "Moved to interview without a screening call by",
)


def is_skipped_screening(
    *,
    call_status: Optional[str],
    vapi_call_id: Optional[str],
    ended_reason: Optional[str],
    summary: Optional[str],
) -> bool:
    if call_status != "completed" or vapi_call_id:
        return False
    if ended_reason == SKIPPED_ENDED_REASON:
        return True
    return bool(summary) and summary.startswith(_LEGACY_SKIP_SUMMARY_PREFIXES)


def is_skipped_call(call) -> bool:
    return is_skipped_screening(
        call_status=call.call_status,
        vapi_call_id=call.vapi_call_id,
        ended_reason=call.ended_reason,
        summary=call.summary,
    )


def skip_reason(call) -> Optional[str]:
    """The sentence HR sees: the summary, minus nothing — it already reads as a reason."""
    return call.summary if is_skipped_call(call) else None
