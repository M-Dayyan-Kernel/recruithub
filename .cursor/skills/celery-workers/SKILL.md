---
name: celery-workers
description: >-
  Adds or changes Celery tasks, queue routing, beat schedules, and worker DB
  access for this backend. Enforces named queues via celery_queues.py (no
  queue= at enqueue), get_celery_db NullPool sessions, one beat process, Windows
  --pool=solo, and health/capacity checks. Use when creating a Celery task,
  enqueueing background work, fixing stuck resume/screening queues, tuning
  workers, or editing celery_app / celery_queues / backend/app/tasks. Do not use
  for pure FastAPI request-path features with no async jobs (use fastapi-feature)
  or LiveKit agent process ops alone.
---

# Celery workers

Follow project queue and session conventions. Do not invent parallel routing or a second DB session pattern.

Canonical sources (read when needed, do not duplicate):

- Routing: [`backend/app/core/celery_queues.py`](backend/app/core/celery_queues.py)
- App + beat + context headers: [`backend/app/core/celery_app.py`](backend/app/core/celery_app.py)
- Ops / scale: [`backend/DEPLOY-CELERY.md`](backend/DEPLOY-CELERY.md)
- Screening caps: [`backend/DEPLOY-SCREENING.md`](backend/DEPLOY-SCREENING.md)
- Interview queue notes: [`backend/DEPLOY-INTERVIEW.md`](backend/DEPLOY-INTERVIEW.md)
- Logging context propagation: `backend-logging` skill

## Queues (do not freestyle)

| Queue | Workload |
|-------|----------|
| `resume` | Resume parse/shortlist, stuck recovery, `run_shortlist` |
| `shortlist` | Compatibility name; current tasks route to `resume` |
| `screening` | Vapi dial, webhooks, transcript enrich, beat dispatch |
| `interviews` | Assessment schedule, report generation |

**Producers never pass `queue=`.** Register the task name in `TASK_ROUTES` in `celery_queues.py`, then enqueue with `.delay` / `.apply_async` args only. If a new task is missing from `TASK_ROUTES`, it lands on the default queue and production workers will miss it.

Also update `CELERY_QUEUE_NAMES` / deploy scripts only when introducing a genuine new queue (rare — prefer extending an existing one).

## Adding a task

1. Implement under `backend/app/tasks/` with a stable name matching `tasks.<name>` in `TASK_ROUTES`.
2. Add the route entry in `celery_queues.py` before shipping producers.
3. DB inside tasks: **only** `async with get_celery_db() as session:` from `app.core.database` (NullPool). Never reuse the FastAPI engine/`get_db` pool across Celery's `asyncio.run()` loops — that breaks on Windows and flakes elsewhere.
4. Prefer `apply_async` when you need `countdown` / retries; keep args JSON-serializable (UUIDs as `str`).
5. Log with `app.*` loggers; leave `x_request_id` / `x_user_id` / `x_tenant_id` headers alone so worker context stays tied to the API request (see `backend-logging`).

## Beat

- **Exactly one** beat process per environment. Two beats double-dispatch screening/recovery.
- Schedules live in celery app config (today: `dispatch_pending_screening_calls` ~60s, `recover_stuck_resume_processing` ~120s). New periodic work goes through beat + a routed task — not a homemade cron inside the API.

## Local vs production

| Env | Pattern |
|-----|---------|
| Windows / `start-dev.ps1` | One worker, **all queues**, `--pool=solo` via `scripts/run-celery-worker.ps1` |
| Linux / prod | Prefork; **dedicated workers per queue** via `scripts/run-celery-worker.sh <queue>` |

Concurrency defaults: `config.yaml` → `celery.queues.*.concurrency`. Override with `CELERY_RESUME_CONCURRENCY` / `CELERY_SCREENING_CONCURRENCY` when needed. After YAML edits, restart API **and** workers.

## Before calling it done

- [ ] Task listed in `TASK_ROUTES` with the correct queue
- [ ] No `queue=` kwarg on producer calls
- [ ] Task DB uses `get_celery_db`
- [ ] Failures isolated; retries/countdowns intentional
- [ ] If enqueue is gated, callers check `celery_queue_available(...)` / respect 503 behavior (see resume upload + screening triggers)
- [ ] Sanity: `GET /api/health/celery` shows workers subscribed to the queues you expect

## Common failures

| Symptom | Likely cause |
|---------|----------------|
| Upload OK, resumes stay queued | No `resume` worker |
| Shortlist 503 | No `resume` worker |
| Screening 503 | No `screening` worker |
| Stuck `processing` | Worker crash; beat recovery or UI retry |
| events.log full of celery noise | Celery loggers raised to INFO — do not |
