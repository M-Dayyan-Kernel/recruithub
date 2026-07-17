# Mock Mode — Test Without External API Costs

Use mock mode during daily development to avoid charges from OpenAI, Vapi, LiveKit, and Gmail.

## Quick start

1. Copy or edit `backend/.env`:

```env
MOCK_EXTERNAL_APIS=true
```

2. Restart the API server and Celery worker (they read `.env` at startup).

3. Confirm mock mode is on:

```bash
curl http://localhost:8000/health
```

Expected response includes:

```json
{
  "status": "ok",
  "mock_mode": true,
  "mocked_services": ["openai", "vapi", "livekit", "email"]
}
```

4. Use the HR app and Candidate app normally — pipeline flows work with fake data.

## What gets mocked

| Service | Real API | Mock behaviour |
|---------|----------|----------------|
| **OpenAI** | Resume parse, JD parse, shortlist, screening extraction, interview assessment | Deterministic fake JSON |
| **Vapi** | Outbound screening calls | Fake call ID; polling returns a completed call + transcript after ~2s |
| **LiveKit** | Room create + JWT tokens | Fake tokens; no real room (see limitations below) |
| **Gmail** | Interview / rejection emails | Logged to console, returns success |

## Granular flags (optional)

Instead of mocking everything, enable only what you need:

```env
MOCK_EXTERNAL_APIS=f
MOCK_VAPI=truealse
MOCK_OPENAI=true
MOCK_EMAIL=true
# MOCK_LIVEKIT=false  → use real LiveKit for interview room testing
```

Any flag set to `true` mocks that service. `MOCK_EXTERNAL_APIS=true` mocks **all** of them.

## Typical workflows

### Daily feature development (free)

```env
MOCK_EXTERNAL_APIS=true
```

Test: job creation → resume upload → shortlist → screening → interviews → reports.

### Test real voice screening only

```env
MOCK_EXTERNAL_APIS=false
MOCK_OPENAI=true
MOCK_VAPI=false
MOCK_LIVEKIT=true
MOCK_EMAIL=true
```

Requires valid `VAPI_API_KEY` and `VAPI_PHONE_NUMBER_ID`.

### Pre-release smoke test (real APIs)

```env
MOCK_EXTERNAL_APIS=false
```

Set all real API keys. Run one full pipeline end-to-end.

## Limitations

- **LiveKit interview room**: With `MOCK_LIVEKIT=true`, the candidate app receives a fake JWT — the WebRTC room will **not** connect. Use **Complete mock interview** on the candidate landing page, or **Complete mock interview** on the HR Interviews → Scheduled tab. Assessment is generated automatically.
- **Interview agent** (`python interview_agent.py dev`): Runs as a separate process and still uses real OpenAI/LiveKit unless you don't start it. In full mock mode, skip the agent — assessment is triggered on interview complete.
- **Celery worker** must be running for async tasks (parse, shortlist, screening simulation, assessment).

## Logs

Mock calls are logged with a `[MOCK SERVICE]` prefix, e.g.:

```
INFO [MOCK VAPI] GET /call/mock-vapi-... — no external API call made
INFO [MOCK OPENAI] shortlist assessment (gpt-4o) — no external API call made
```

## No separate testing branch needed

Keep one working branch. Toggle `MOCK_EXTERNAL_APIS` in `.env` instead of merging a mock branch.
