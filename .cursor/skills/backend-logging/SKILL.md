---
name: backend-logging
description: >-
  Applies the FastAPI/Celery nested JSON logging system: three channels
  (events/errors/http), IST timestamps, skim-friendly top-level fields with
  detail under fields, app.* INFO for business events, Celery context
  propagation (request_id/tenant_id/user_id), and no secrets/PII in messages.
  Use when adding or reviewing logging, using log_event, fixing events.log /
  missing tenant_id on workers, middleware access logs, or editing
  backend/app/core/logging.py / celery_app.py. Do not use for frontend console
  logging, Sentry-only changes, or docs outside logging conventions.
---

# Backend logging standards

Follow these conventions whenever you add or change backend logs. Do not invent a parallel logger, format, or log file.

Canonical implementation: [`backend/app/core/logging.py`](backend/app/core/logging.py)  
Celery context wiring: [`backend/app/core/celery_app.py`](backend/app/core/celery_app.py)  
Config (YAML only): [`backend/app/core/config.yaml`](backend/app/core/config.yaml) → `logging:`  
Example lines: [references/examples.md](references/examples.md)

## Channels (where a line lands)

| File | What goes there | Rule |
|------|-----------------|------|
| `backend/logs/events.log` | Business activity | `app.*` loggers at **INFO** only |
| `backend/logs/errors.log` | Failures / warnings | Any logger except `http.access` at **WARNING+** |
| `backend/logs/http.log` | HTTP access | Logger `http.access` only (middleware via `log_http_access`) |

Stdout mirrors the same records (`logging.format: text|json` in config.yaml). File handlers always write nested JSON NDJSON.

Celery framework loggers (`celery`, `celery.beat`, `celery.app.trace`, …) stay at **WARNING** — do not reopen them to INFO or events.log fills with beat/trace noise.

## Record shape (always)

**Top-level (skim):** `ts`, `level`, `msg`, `request_id`, `service`

**Everything else** under `fields` (logger, env, version, tenant_id, user_id, task_id, http/event/error nests, …).

- `ts` is **IST** (`Asia/Kolkata`), e.g. `2026-08-04T10:35:08.517+05:30`
- `service` is a string: `ai-recruitment-api` or `ai-recruitment-worker`
- Missing IDs are omitted from `fields` or `request_id: null` — never invent placeholders in business msgs
- One JSON object per line (NDJSON). Do not pretty-print multi-line JSON into the files.

HTTP specifics: put `method` / `path` / `status` / `duration_ms` under `fields.http`; put `client_ip`, `user_agent`, `route`, `bytes_out` as siblings under `fields`.

Errors with `exc_info`: put `type`, `message`, `stack` under `fields.error`.

Optional structured business payload: pass `extra={"event": {...}}` so it appears under `fields.event`.

## How to log in application code

```python
import logging
from app.core.logging import log_event, get_actor_label, plural

logger = logging.getLogger(__name__)  # MUST be under app.* (e.g. app.services.foo)
```

| Intent | Call | Lands in |
|--------|------|----------|
| Business success / progress | `log_event(logger, "…")` or `logger.info(...)` | `events.log` |
| Recoverable problem | `logger.warning(...)` | `errors.log` |
| Failure / unexpected | `logger.error(...)` or `logger.exception(...)` | `errors.log` |
| HTTP access | Only middleware → `log_http_access(...)` | `http.log` |

Prefer plain, readable `msg` sentences (existing style). Put IDs and machine detail in structured `extra` / exception info, not giant dump strings.

```python
# Good — business event
log_event(logger, "%s uploaded %s for job %r", get_actor_label(), plural(n, "resume"), job_title)

# Good — failure with stack
logger.exception("Failed to enqueue screening")

# Bad — Celery plumbing as a “business event”
logging.getLogger("celery.app.trace").info(...)  # never

# Bad — non-app logger into events
logging.getLogger("myutil").info("done")  # filtered out of events.log
```

Never call `setup_logging` from random modules; API + Celery entrypoints already do.

## Request / actor / worker context

Context lives in ContextVars and is injected into every record by `ContextFilter`:

| Field | Set by |
|-------|--------|
| `request_id` | `RequestLoggingMiddleware` (`X-Request-ID` in/out) |
| `user_id`, `tenant_id` | `set_actor_context(...)` after auth |
| `task_id` | Celery `task_prerun` |

**Consistency API → worker:** Celery stamps current context on publish (`before_task_publish` headers `x_request_id` / `x_user_id` / `x_tenant_id`) and restores on `task_prerun`. When enqueueing from a request that already has actor context, **do nothing special** — headers propagate automatically. Do not strip or override those headers.

Beat-only / anonymous jobs may legitimately lack `request_id` / `user_id` / `tenant_id`. Do not fake them.

When auth resolves a user, call `set_actor_context(user_id=..., tenant_id=..., role=..., name=...)` (already done in authentication context service). New auth paths must do the same.

## Config

Logging tunables live **only** in `config.yaml` under `logging:` (`level`, `format`, `dir`, `max_bytes`, `backup_count`). Do not put `LOG_*` back into `.env` / Settings.

Read via `config.logging.level` (etc.) from `app.core.config_loader`.

## Do / don't

**Do**

- Use `logging.getLogger(__name__)` so the name starts with `app.`
- Keep messages human-readable; correlate with `request_id`
- Use `logger.exception` inside `except` so stacks hit `fields.error`
- Return / expose `X-Request-ID` on API responses (middleware already does)

**Don't**

- Log passwords, tokens, full resumes, raw JD PII, or card data
- Open new log files or alternate formatters for app code
- Put celery/uvicorn/httpx INFO back into `events.log`
- Rely on `print()` for operational signal
- Commit contents of `backend/logs/*.log` (directory is gitignored except `.gitkeep`)

## Checklist for new logging

1. Logger is `app.*` via `__name__`
2. INFO = business event; WARNING/ERROR = problem
3. No secrets in `msg` or `fields`
4. If work continues in Celery from an authed request, context headers are left intact
5. For structured domain facts, use `extra={"event": {...}}` rather than stuffing JSON into `msg`
6. Confirm mentally: event → `events.log`, failure → `errors.log`, HTTP → middleware only
