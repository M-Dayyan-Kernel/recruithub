# Screening deployment notes

Production hardening for voice screening (Vapi outbound calls).

## Workers

Screening tasks route to the `screening` Celery queue. Ensure at least one worker listens to it:

```bash
./scripts/run-celery-worker.sh screening
# or all queues in dev:
./scripts/run-celery-worker.sh all
```

Beat must run exactly once so `dispatch_pending_screening_calls` can:
- re-dispatch pending dials when live-call slots free up
- finalize overdue live calls past `screening.max_call_duration_minutes`

## Concurrent live calls

`concurrency.max_live_screening_calls` (default **5**) caps simultaneous `initiated` / `in_progress` calls **per tenant**.

When at capacity, `initiate_screening_call` leaves the row `pending` and re-queues after `screening.live_slot_defer_sec` (default 45s).

Tune against your Vapi/Twilio plan:

```yaml
concurrency:
  max_live_screening_calls: 5
```

Or env: not currently overridden — edit `config.yaml` and restart API + Celery.

## Webhook security

Set a shared secret in production:

```env
BACKEND_PUBLIC_URL=https://api.example.com
VAPI_WEBHOOK_SECRET=long-random-string
```

Dial time builds `assistant.serverUrl` as:

`{BACKEND_PUBLIC_URL}/api/screening/webhook?token={VAPI_WEBHOOK_SECRET}`

When the secret is set, webhooks without a matching `token` return **401**.  
Empty secret (local dev) accepts unauthenticated webhooks and logs a warning.

## Call window + slotting

Deferred dials happen for:

1. Outside the job call window (`screening_call_from` / `to` / timezone)
2. Tenant at live-call capacity
3. Another live call already in progress for the same candidate

Trigger API still returns `initiated` vs `queued` based on immediate vs delayed enqueue (window). Capacity deferrals happen inside the worker after enqueue.

## Dial retries

Transient Vapi initiation failures keep `call_status=pending` so Celery retries can re-dial.  
Auth/config errors mark `failed` without retry. After max Celery retries, the row is marked `failed`.

## Status integrity

Terminal statuses (`completed`, `failed`) never regress to `in_progress` / `pending` from late Vapi events.

Overdue live calls (older than `max_call_duration_minutes`, default 15) are force-finalized by beat only after a normal finalize attempt fails.
