"""Centralized logging for the FastAPI app and Celery workers.

Emits nested JSON NDJSON to rotating files under LOG_DIR:
  - events.log  — INFO from application loggers (excludes http.access)
  - errors.log  — WARNING+ from application loggers (excludes http.access)
  - http.log    — http.access access records only

Each line has skim-friendly top-level keys (ts in IST, level, msg, request_id,
service) and detail under ``fields``.

Stdout mirrors the same records (nested JSON when LOG_FORMAT=json, else plain text).
Request IDs are tracked for response headers / error payloads.
"""

from __future__ import annotations

import json
import logging
import re
import sys
import uuid
from contextvars import ContextVar
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
_HTTP_CORE_KEYS = ("method", "path", "status", "duration_ms")

HTTP_LOGGER_NAME = "http.access"

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
task_id_ctx: ContextVar[str] = ContextVar("task_id", default="-")
actor_label_ctx: ContextVar[str] = ContextVar("actor_label", default="Someone")
user_id_ctx: ContextVar[Optional[str]] = ContextVar("user_id", default=None)
tenant_id_ctx: ContextVar[Optional[str]] = ContextVar("tenant_id", default=None)

_CONFIGURED = False
_SERVICE_NAME = "ai-recruitment-api"
_SERVICE_ENV = "development"
_SERVICE_VERSION = "1.0.0"

_HEALTH_PROBE_PATH_RE = re.compile(
    r"^/(?:api/)?health(?:/(?:live|ready|celery))?$"
)

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


def _null_if_blank(value: Any) -> Any:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text == "-":
        return None
    return text


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()  # type: ignore[attr-defined]
        record.task_id = task_id_ctx.get()  # type: ignore[attr-defined]
        record.actor = actor_label_ctx.get()  # type: ignore[attr-defined]
        record.user_id = user_id_ctx.get()  # type: ignore[attr-defined]
        record.tenant_id = tenant_id_ctx.get()  # type: ignore[attr-defined]
        return True


class HttpChannelFilter(logging.Filter):
    """Only records from the HTTP access logger."""

    def filter(self, record: logging.LogRecord) -> bool:
        return record.name == HTTP_LOGGER_NAME


class EventsChannelFilter(logging.Filter):
    """INFO-only business activity from app.* loggers; excludes HTTP access."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name == HTTP_LOGGER_NAME:
            return False
        if not record.name.startswith("app."):
            return False
        return record.levelno == logging.INFO


class ErrorsChannelFilter(logging.Filter):
    """WARNING+ failures; excludes HTTP access."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name == HTTP_LOGGER_NAME:
            return False
        return record.levelno >= logging.WARNING


class NestedJsonFormatter(logging.Formatter):
    """One nested JSON object per line (NDJSON).

    Top-level stays skim-friendly: ts (IST), level, msg, request_id, service.
    Detail lives under ``fields``.
    """

    def __init__(
        self,
        *,
        service_name: str = "ai-recruitment-api",
        service_env: str = "development",
        service_version: str = "1.0.0",
    ) -> None:
        super().__init__()
        self.service_name = service_name
        self.service_env = service_env
        self.service_version = service_version

    def format(self, record: logging.LogRecord) -> str:
        local = datetime.fromtimestamp(record.created, tz=IST)
        ts = local.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + local.strftime("%z")
        # %z is +0530; normalize to +05:30
        if len(ts) >= 5 and ts[-5] in "+-" and ts[-3] != ":":
            ts = f"{ts[:-2]}:{ts[-2:]}"

        fields: dict[str, Any] = {
            "logger": record.name,
            "env": self.service_env,
            "version": self.service_version,
        }
        tenant_id = _null_if_blank(getattr(record, "tenant_id", None))
        user_id = _null_if_blank(getattr(record, "user_id", None))
        task_id = _null_if_blank(getattr(record, "task_id", None))
        if tenant_id is not None:
            fields["tenant_id"] = tenant_id
        if user_id is not None:
            fields["user_id"] = user_id
        if task_id is not None:
            fields["task_id"] = task_id

        http_payload = getattr(record, "http", None)
        if isinstance(http_payload, dict) and http_payload:
            core = {k: http_payload[k] for k in _HTTP_CORE_KEYS if k in http_payload}
            fields["http"] = core
            for key, value in http_payload.items():
                if key in _HTTP_CORE_KEYS:
                    continue
                if key == "bytes" and isinstance(value, dict):
                    if value.get("in") is not None:
                        fields["bytes_in"] = value["in"]
                    if value.get("out") is not None:
                        fields["bytes_out"] = value["out"]
                elif value is not None:
                    fields[key] = value

        event_payload = getattr(record, "event", None)
        if isinstance(event_payload, dict) and event_payload:
            fields["event"] = event_payload

        if record.exc_info:
            exc_type = record.exc_info[0]
            exc_val = record.exc_info[1]
            stack = self.formatException(record.exc_info)
            fields["error"] = {
                "type": getattr(exc_type, "__name__", str(exc_type)) if exc_type else "Exception",
                "message": str(exc_val) if exc_val is not None else record.getMessage(),
                "stack": stack,
            }
        elif record.levelno >= logging.WARNING and not http_payload:
            error_payload = getattr(record, "error", None)
            if isinstance(error_payload, dict) and error_payload:
                fields["error"] = error_payload

        payload: dict[str, Any] = {
            "ts": ts,
            "level": record.levelname,
            "msg": record.getMessage(),
            "request_id": _null_if_blank(getattr(record, "request_id", None)),
            "service": self.service_name,
            "fields": fields,
        }
        return json.dumps(payload, ensure_ascii=False)


def get_request_id() -> str:
    return request_id_ctx.get()


def get_user_id() -> Optional[str]:
    return user_id_ctx.get()


def get_tenant_id() -> Optional[str]:
    return tenant_id_ctx.get()


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
    """Store actor label for text logs and IDs for nested JSON context."""
    role_label = (role or "user").replace("_", " ").title()
    if name and name.strip():
        actor_label_ctx.set(f"{name.strip()} ({role_label})")
    else:
        actor_label_ctx.set(role_label)
    user_id_ctx.set(str(user_id) if user_id is not None else None)
    tenant_id_ctx.set(str(tenant_id) if tenant_id is not None else None)


def clear_actor_context() -> None:
    actor_label_ctx.set("Someone")
    user_id_ctx.set(None)
    tenant_id_ctx.set(None)


def get_actor_label() -> str:
    return actor_label_ctx.get()


# Celery message headers used to propagate logging context to workers.
REQUEST_ID_HEADER = "x_request_id"
USER_ID_HEADER = "x_user_id"
TENANT_ID_HEADER = "x_tenant_id"


def capture_logging_context_headers() -> dict[str, str]:
    """Snapshot current request/actor context for Celery publish headers."""
    headers: dict[str, str] = {}
    request_id = _null_if_blank(get_request_id())
    if request_id:
        headers[REQUEST_ID_HEADER] = str(request_id)
    user_id = get_user_id()
    if user_id:
        headers[USER_ID_HEADER] = str(user_id)
    tenant_id = get_tenant_id()
    if tenant_id:
        headers[TENANT_ID_HEADER] = str(tenant_id)
    return headers


def apply_logging_context_headers(headers: Optional[dict[str, Any]] = None) -> None:
    """Restore request/actor context from Celery headers (or clear if absent)."""
    headers = headers or {}
    request_id = headers.get(REQUEST_ID_HEADER)
    if request_id:
        set_request_id(str(request_id))
    else:
        clear_request_id()

    user_id = headers.get(USER_ID_HEADER)
    tenant_id = headers.get(TENANT_ID_HEADER)
    if user_id is not None or tenant_id is not None:
        set_actor_context(user_id=user_id, tenant_id=tenant_id)
    else:
        clear_actor_context()


def clear_logging_context() -> None:
    """Clear request, task, and actor context (e.g. after a Celery task)."""
    clear_request_id()
    clear_task_id()
    clear_actor_context()


def is_health_probe_path(path: str) -> bool:
    """Liveness/readiness/celery checks — omit from routine access logs."""
    return bool(_HEALTH_PROBE_PATH_RE.match(path or ""))


def is_poll_path(path: str) -> bool:
    return bool(_POLL_PATH_RE.search(path or ""))


def log_event(logger: logging.Logger, message: str, *args: Any) -> None:
    """Emit a plain-English INFO business message (routed to events.log)."""
    if args:
        logger.info(message, *args)
    else:
        logger.info(message)


def log_http_access(
    *,
    method: str,
    path: str,
    status: int,
    duration_ms: int,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    route: Optional[str] = None,
    bytes_in: Optional[int] = None,
    bytes_out: Optional[int] = None,
    msg: Optional[str] = None,
) -> None:
    """Emit one nested HTTP access record to the http.access logger."""
    http_payload: dict[str, Any] = {
        "method": method,
        "path": path,
        "status": int(status),
        "duration_ms": int(duration_ms),
        "client_ip": client_ip,
        "user_agent": user_agent,
    }
    if route:
        http_payload["route"] = route
    if bytes_in is not None or bytes_out is not None:
        http_payload["bytes"] = {"in": bytes_in, "out": bytes_out}

    if status >= 500:
        default_msg = "request failed"
    elif status >= 400:
        default_msg = "request rejected"
    else:
        default_msg = "request completed"

    logging.getLogger(HTTP_LOGGER_NAME).info(
        msg or default_msg,
        extra={"http": http_payload},
    )


def reset_logging_configuration() -> None:
    """Clear handlers so setup_logging can run again (tests)."""
    global _CONFIGURED
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()
    http_logger = logging.getLogger(HTTP_LOGGER_NAME)
    for handler in list(http_logger.handlers):
        http_logger.removeHandler(handler)
        handler.close()
    http_logger.propagate = True
    _CONFIGURED = False


def setup_logging(
    level: str = "INFO",
    *,
    log_format: str = "text",
    log_dir: str = "logs",
    log_max_bytes: int = 10_485_760,
    log_backup_count: int = 5,
    service_name: str = "ai-recruitment-api",
    service_env: str = "development",
    service_version: str = "1.0.0",
    force: bool = False,
) -> None:
    """Configure root + http.access loggers once. Safe to call from API and Celery."""
    global _CONFIGURED, _SERVICE_NAME, _SERVICE_ENV, _SERVICE_VERSION
    log_level = getattr(logging, level.upper(), logging.INFO)
    if _CONFIGURED and not force:
        root = logging.getLogger()
        root.setLevel(log_level)
        return

    if force:
        reset_logging_configuration()

    _SERVICE_NAME = service_name
    _SERVICE_ENV = service_env
    _SERVICE_VERSION = service_version

    nested_formatter = NestedJsonFormatter(
        service_name=service_name,
        service_env=service_env,
        service_version=service_version,
    )
    context_filter = ContextFilter()

    # --- stdout ---
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.addFilter(context_filter)
    if (log_format or "text").lower() == "json":
        stdout_handler.setFormatter(nested_formatter)
    else:
        fmt = "%(asctime)s | %(levelname)-8s | %(message)s"
        stdout_handler.setFormatter(logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S"))

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(stdout_handler)
    root.setLevel(log_level)

    # --- rotating file channels (always nested JSON) ---
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)

    def _file_handler(filename: str, channel_filter: logging.Filter) -> RotatingFileHandler:
        handler = RotatingFileHandler(
            log_path / filename,
            maxBytes=log_max_bytes,
            backupCount=log_backup_count,
            encoding="utf-8",
        )
        handler.setLevel(logging.DEBUG)
        handler.addFilter(context_filter)
        handler.addFilter(channel_filter)
        handler.setFormatter(nested_formatter)
        return handler

    root.addHandler(_file_handler("events.log", EventsChannelFilter()))
    root.addHandler(_file_handler("errors.log", ErrorsChannelFilter()))

    http_logger = logging.getLogger(HTTP_LOGGER_NAME)
    http_logger.handlers.clear()
    http_logger.setLevel(logging.INFO)
    http_logger.propagate = True  # also mirrors to stdout via root
    http_file = _file_handler("http.log", HttpChannelFilter())
    http_logger.addHandler(http_file)

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    # Celery framework chatter (beat/mingle/trace) stays off INFO; app.tasks.* still log normally.
    logging.getLogger("celery").setLevel(logging.WARNING)
    logging.getLogger("celery.beat").setLevel(logging.WARNING)
    logging.getLogger("celery.app.trace").setLevel(logging.WARNING)
    logging.getLogger("celery.worker.consumer").setLevel(logging.WARNING)
    logging.getLogger("celery.worker.strategy").setLevel(logging.WARNING)
    logging.getLogger("celery.apps.worker").setLevel(logging.WARNING)

    _CONFIGURED = True
