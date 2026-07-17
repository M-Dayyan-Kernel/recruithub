"""Centralized logging setup for the FastAPI app and Celery workers.

Messages are meant to be human-readable sentences — no UUIDs, status codes,
or timings in the printed line. Request IDs are still tracked internally for
response headers / error payloads.
"""

from __future__ import annotations

import logging
import re
import sys
import uuid
from contextvars import ContextVar
from typing import Any, Optional

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
task_id_ctx: ContextVar[str] = ContextVar("task_id", default="-")
actor_label_ctx: ContextVar[str] = ContextVar("actor_label", default="Someone")

_CONFIGURED = False

_POLL_PATH_RE = re.compile(
    r"("
    r"/health$"
    r"|/shortlist/status$"
    r"|/jobs/[^/]+/candidates$"
    r"|/jobs/[^/]+/shortlist$"
    r"|/jobs/[^/]+/screening$"
    r"|/api/settings$"
    r"|/api/auth/me$"
    r"|/api/jobs$"
    r"|/api/jobs/[^/]+$"
    r")"
)

_ONES = (
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
)
_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")


def words(n: Any) -> str:
    """Spell out a small non-negative integer; fall back to 'several' for large values."""
    try:
        value = int(n)
    except (TypeError, ValueError):
        return "some"
    if value < 0:
        return "some"
    if value < 20:
        return _ONES[value]
    if value < 100:
        tens, ones = divmod(value, 10)
        return _TENS[tens] if ones == 0 else f"{_TENS[tens]}-{_ONES[ones]}"
    return "several"


def plural(n: Any, singular: str, plural_form: Optional[str] = None) -> str:
    """Return 'one resume' / 'two resumes' style phrase."""
    count = 0
    try:
        count = int(n)
    except (TypeError, ValueError):
        return f"some {plural_form or singular + 's'}"
    label = singular if count == 1 else (plural_form or f"{singular}s")
    return f"{words(count)} {label}"


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()  # type: ignore[attr-defined]
        record.task_id = task_id_ctx.get()  # type: ignore[attr-defined]
        record.actor = actor_label_ctx.get()  # type: ignore[attr-defined]
        return True


def get_request_id() -> str:
    return request_id_ctx.get()


def set_request_id(value: Optional[str] = None) -> str:
    rid = (value or "").strip() or str(uuid.uuid4())
    request_id_ctx.set(rid)
    return rid


def clear_request_id() -> None:
    request_id_ctx.set("-")


def set_task_id(value: Optional[str] = None) -> str:
    task_id_ctx.set((value or "").strip() or "-")
    return task_id_ctx.get()


def clear_task_id() -> None:
    task_id_ctx.set("-")


def set_actor_context(
    *,
    user_id: Any = None,
    tenant_id: Any = None,
    role: Optional[str] = None,
    name: Optional[str] = None,
) -> None:
    """Store a human label only — IDs are not printed."""
    role_label = (role or "user").replace("_", " ").title()
    if name and name.strip():
        actor_label_ctx.set(f"{name.strip()} ({role_label})")
    else:
        actor_label_ctx.set(role_label)


def clear_actor_context() -> None:
    actor_label_ctx.set("Someone")


def get_actor_label() -> str:
    return actor_label_ctx.get()


def is_poll_path(path: str) -> bool:
    return bool(_POLL_PATH_RE.search(path or ""))


def log_event(logger: logging.Logger, message: str, *args: Any) -> None:
    """Emit a plain-English INFO business message."""
    if args:
        logger.info(message, *args)
    else:
        logger.info(message)


def setup_logging(level: str = "INFO") -> None:
    """Configure root logger once. Safe to call from API and Celery processes."""
    global _CONFIGURED
    if _CONFIGURED:
        root = logging.getLogger()
        root.setLevel(getattr(logging, level.upper(), logging.INFO))
        return

    log_level = getattr(logging, level.upper(), logging.INFO)
    # Words only — no request/user/tenant UUIDs in the printed line
    fmt = "%(asctime)s | %(levelname)-8s | %(message)s"
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S"))
    handler.addFilter(ContextFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(log_level)

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("celery").setLevel(log_level)
    logging.getLogger("celery.worker.strategy").setLevel(logging.WARNING)

    _CONFIGURED = True
