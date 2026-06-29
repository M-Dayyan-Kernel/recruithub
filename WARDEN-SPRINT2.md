# Warden Code Review — Sprint 2
**Verdict: REVIEW_PASS ✅**
*Reviewed by Warden 🛡 | 2026-06-19*

---

## Summary

Sprint 2 foundation code is solid. Forge produced clean, idiomatic Python with proper SQLAlchemy 2.0 style, well-structured FastAPI routing, and correct Pydantic v2 schemas. Nova's frontend scaffolds are production-quality with proper TypeScript, TanStack Query, and Axios setup. A CSS issue with shadcn CSS variables was caught and fixed by Goku during QA. No blocking issues remain.

---

## Findings

### BLOCKING
*None.*

### IMPORTANT

**[I1] — CSS `@apply border-border` with undefined custom property**
- **File:** `hr-app/src/index.css`, `candidate-app/src/index.css`
- **Issue:** Nova used shadcn CSS variable convention (`border-border`, `bg-background`) without the full shadcn Tailwind plugin setup. These `@apply` directives fail at build time.
- **Status:** ✅ Fixed by Goku — replaced with direct `theme()` calls and Tailwind color classes.

**[I2] — `resume_embedding` column in migration uses `sa.Text` not `vector`**
- **File:** `alembic/versions/001_initial_schema.py`
- **Issue:** The migration creates `resume_embedding` as `Text` (fallback from SQLAlchemy model) then adds `resume_embedding_vec vector(1536)` separately. This creates two columns instead of one clean vector column. The model uses `Vector(1536)` correctly but the migration doesn't match exactly.
- **Recommendation:** In Sprint 3 when the embedding service is implemented, consolidate to a single `resume_embedding` vector column. Low risk for POC since the model is correct.
- **Status:** ⚠️ Not blocking for Sprint 2 (no DB in use yet). Flag for Forge in Sprint 3.

**[I3] — No `uvicorn[standard]` verified in PATH**
- The requirements.txt lists `uvicorn[standard]` but we haven't verified the server starts. No DB means we can't run `uvicorn app.main:app` with real routes. 
- **Status:** Acceptable for Sprint 2 — Sprint 3 will bring Docker up and verify server start.

### MINOR

**[m1] — `allow_credentials=True` on open CORS**
- `main.py` sets `allow_credentials=True` with `allow_origins=["*"]`. Browsers reject this combination. Since POC has no auth/cookies, `allow_credentials` should be `False`.
- **Fix:** Remove `allow_credentials=True` from CORSMiddleware.

**[m2] — Task placeholder files have no `@celery_app.task` decorator on imports**
- `tasks/__init__.py` is empty. Celery discovers tasks via `include=` in celery_app config which is correct, but the task files need to be importable from the worker process.
- **Status:** Fine for Sprint 2 — tasks are stubs. Forge will flesh out in Sprint 3.

**[m3] — `updated_at` on Job model won't auto-update on SQLAlchemy `onupdate`**
- SQLAlchemy's `onupdate=func.now()` only fires on SQL UPDATE statements through the ORM when using `server_onupdate`. The current setup may not auto-update on partial updates.
- **Recommendation:** Test in Sprint 3 when PATCH endpoint is exercised with real DB.

---

## What's Good

- **SQLAlchemy 2.0 mapped_column style** — clean, type-safe, modern. 
- **Async throughout** — engine, session, all route handlers are properly async. 
- **All 6 models have proper FKs and relationships** — cascade deletes set correctly.
- **Pydantic v2 `model_config = ConfigDict(from_attributes=True)`** — correct ORM mode setup.
- **Router structure** — clean separation, easy to find and extend in future sprints.
- **Nova's API client** — Axios interceptors are clean, error extraction is correct, QueryClient defaults are sensible.
- **docker-compose.yml** — uses `ankane/pgvector` which has the extension pre-installed. Health checks on both services. Named volumes. 

---

## Verdict

```
REVIEW_PASS ✅
Sprint 3 is authorized from Warden's perspective.
Fix [m1] (CORS credentials) in Sprint 3 opening tasks.
Track [I2] (migration column) for Forge in Sprint 3.
```
