"""
Call window helpers — determine whether outbound screening calls are allowed
based on per-job time-of-day settings and timezone.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo


class CallWindowJob(Protocol):
    screening_call_from: time | None
    screening_call_to: time | None
    screening_timezone: str


DEFAULT_FROM = time(9, 0)
DEFAULT_TO = time(18, 0)
DEFAULT_TZ = "Asia/Kolkata"


def _job_from(job: CallWindowJob) -> time:
    return job.screening_call_from or DEFAULT_FROM


def _job_to(job: CallWindowJob) -> time:
    return job.screening_call_to or DEFAULT_TO


def _job_tz(job: CallWindowJob) -> ZoneInfo:
    try:
        return ZoneInfo(job.screening_timezone or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def _time_in_window(current: time, start: time, end: time) -> bool:
    """Return True if current is within [start, end], supporting overnight windows."""
    if start <= end:
        return start <= current <= end
    # Overnight: e.g. 22:00 – 06:00
    return current >= start or current <= end


def is_within_call_window(job: CallWindowJob, now: datetime | None = None) -> bool:
    tz = _job_tz(job)
    local_now = (now or datetime.now(tz)).astimezone(tz)
    return _time_in_window(local_now.time(), _job_from(job), _job_to(job))


def seconds_until_next_window(job: CallWindowJob, now: datetime | None = None) -> int:
    """
    Seconds until the next call window opens.
    Returns 0 if currently within the window.
    """
    if is_within_call_window(job, now):
        return 0

    tz = _job_tz(job)
    local_now = (now or datetime.now(tz)).astimezone(tz)
    start = _job_from(job)
    end = _job_to(job)

    today_start = local_now.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
    if local_now.time() < start and start <= end:
        delta = today_start - local_now
        return max(0, int(delta.total_seconds()))

    # Next window is tomorrow (or later today for overnight windows)
    next_start = today_start + timedelta(days=1)
    if start > end and local_now.time() > end:
        # Overnight window: if we're after end but before midnight, next open is today at start
        if local_now.time() > end:
            next_start = today_start
            if local_now >= today_start:
                next_start = today_start + timedelta(days=1)

    delta = next_start - local_now
    return max(0, int(delta.total_seconds()))


def effective_dispatch_delay(job: CallWindowJob, force: bool, min_delay: int = 0) -> tuple[int, bool]:
    """
    Return (countdown_seconds, is_immediate).

    force=True bypasses window (immediate dial).
    force=False schedules for next window if outside.
    """
    if force:
        return min_delay, True

    window_delay = seconds_until_next_window(job)
    if window_delay <= 0:
        return min_delay, True

    return max(min_delay, window_delay), False
