# Interview deployment notes

Production hardening for LiveKit AI interviews (candidate join, webhook, assessment).

## Required processes

| Process | Role |
|---------|------|
| API (`uvicorn`) | Create sessions, public `/start`/`/complete`, LiveKit webhook |
| Celery worker on `interviews` queue | Assessment + scheduled invite dispatch |
| Celery beat | `dispatch_scheduled_interview_emails` |
| Interview agent | LiveKit agent process (process-env LiveKit credentials) |

```bash
./scripts/run-celery-worker.sh interviews
# or all queues in dev:
./scripts/run-celery-worker.sh all
```

See also [`DEPLOY-CELERY.md`](DEPLOY-CELERY.md).

## LiveKit credentials (single-project deploy)

The **API** loads LiveKit URL/key/secret from tenant integrations (with env fallback).

The **interview agent** uses **process environment** (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). Those must match the same LiveKit project as the tenant URL used when starting a room.

If tenant `livekit_url` is unset, `/start` fails loudly with **503** — do not run interviews without a configured URL.

Multi-tenant agent credential routing is out of scope for this deploy model.

## Webhook security

Configure LiveKit to POST room events to:

`{BACKEND_PUBLIC_URL}/api/livekit/webhook`

Verification uses `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` (LiveKit JWT + body sha256 via `WebhookReceiver`).

| Mode | Behavior |
|------|----------|
| Secrets set | Invalid/missing `Authorization` → **401** |
| Secrets empty | Accepts webhooks + warning log (dev only) |
| `MOCK_LIVEKIT=true` | Skip signature verify |

On `room_finished`, only `in_progress` sessions are completed. No stub transcripts are invented.

## Join window

- `expires_at` past → session marked `expired`, `/start` and `/complete` return **410**
- `scheduled_interview_at` in the future → **403** until the window opens
- Early grace: `interview.schedule_early_grace_sec` (default **120**) so slight clock skew does not block candidates

## Start ordering

`/start` creates the LiveKit room **before** committing durable `in_progress` + room metadata. If room/token creation fails, the session stays **`pending`** and the candidate can retry (**502**).

## Assessment failures

`generate_interview_report`:

- Retries transient OpenAI rate-limit / connection errors (`self.retry`)
- Sets `session.status = assessment_failed` on auth failure or exhausted retries
- Empty transcript still produces a soft `needs_review` report (not a hard failure)

HR can call `POST /api/candidates/{id}/interview/retry-assessment` when status is `assessment_failed`.

## Public rate limit

`/api/interview/{token}/start` and `/complete` are limited to **`interview.public_rate_limit_per_minute`** (default **20**) per token. Exceeding the limit returns **429**. Uses Redis when available, otherwise an in-process fallback.

## Config knobs (`config.yaml`)

```yaml
interview:
  schedule_early_grace_sec: 120
  public_rate_limit_per_minute: 20
  assessment_retry:
    delay_sec: 15
    max_attempts: 12
```
