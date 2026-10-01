# CLAUDE.md

**Recruitment Hub** — AI-led, proctored interviews scored against a per-job rubric.

**Stack:** FastAPI + PostgreSQL (pgvector) + Celery/Redis · React 18 + Vite + Tailwind ·
LiveKit (interview agent, egress) · Linode Object Storage (S3) · OpenAI.

**Apps:** `backend/` · `hr-app/` (recruiter + platform admin) · `candidate-app/`
(the proctored interview).

---

## Read before writing UI

| Doc | What it settles |
| --- | --- |
| `docs/UI.md` | Tokens, the hard rules, primitives, layout. **Binding** |
| `PROCTORING.md` | Proctoring states, gates, signals, the demo seed |
| `INTERFACE.md` | API surface, CORS, ports |
| `DEPLOY.md` | Two-server split, env vars |

---

## Typechecking: `tsc -b`, never `tsc --noEmit`

Both frontends use a solution-style `tsconfig.json` (`"files": []` + `references`).
**`tsc --noEmit` there checks zero files and exits 0.** Vite's esbuild does not typecheck
either, so "build passed" proves nothing about types.

```bash
cd hr-app && npx tsc -b --force     # the only command that actually checks
cd candidate-app && npx tsc -b --force
```

This has already hidden a real defect: a component used without its import, which builds
clean and throws `ReferenceError` on render.

---

## Running it locally

Docker runs **Postgres and Redis only**. Everything else runs on the host — there is no
API container, and `docker-compose.app.yml` needs a `.env.production` that does not exist
in this checkout.

```bash
docker compose up -d postgres redis
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000
cd backend && .venv/bin/python interview_agent.py start          # AI interviewer
cd backend && .venv/bin/celery -A app.core.celery_app.celery_app worker \
  --loglevel=info --pool=solo --queues=resume,shortlist,screening,interviews
cd hr-app && npm run dev            # 5173
cd candidate-app && npm run dev      # 5174, falls back to 5175 if taken
```

**Both the agent and the worker are required for a real interview.** Without the agent,
`create_room` dispatches to nothing and the candidate sits in an empty room. Without the
worker, `generate_interview_report.delay(...)` queues and never runs.

Demo data, no application flow needed:

```bash
cd backend && .venv/bin/python -m scripts.seed_proctoring_demo --label round2 --reset
```

`--reset` re-arms the links to pending, clears transcripts and reports, and pushes expiry
out 7 days. The label is what produces the token names.

---

## Things that have bitten

- **CORS** resolves in `backend/app/core/production_validation.py`. Setting `CORS_ORIGINS`
  *replaces* the localhost dev fallback rather than adding to it, and in production the
  app refuses to boot without it. The hardcoded localhost list is unreachable on any
  deployed environment.
- **Egress MP4s are not faststart.** The `moov` atom is at the end of the file, so a
  browser must fetch the whole recording before decoding a frame. Client-side thumbnailing
  is not viable until `-movflags +faststart` is added to the egress step.
- **LiveKit webhooks cannot reach localhost**, so `recording_ready` stays null. The report
  service falls back to an S3 existence check.
- **`recruitment-hub` (S3) is shared** with other environments. This database knows about a
  fraction of what is in the bucket. Never bulk-delete by prefix.

---

## Conventions

- Semantic tokens only in components. A hex literal in a component is a bug — see
  `docs/UI.md §1`.
- Comments explain **why**, especially where the obvious approach was tried and failed.
- Verify before claiming. If it was not run or not seen, say so.
