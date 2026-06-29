# WARDEN — Sprint 3 Code Review
**Project:** AI Recruitment POC  
**Sprint:** 3 (+ post-sprint live fixes 2026-06-22)  
**Reviewer:** Warden 🛡  
**Date:** 2026-06-22  

---

## Verdict

> **REVIEW_FAIL**

Sprint 3 has solid bones — the backend task chain is well-structured, error handling is thorough, the key post-sprint fixes (NullPool, CORS, `parse_status` naming) all landed correctly. Good work.

But there are **4 P0 bugs** blocking Sprint 4. Two are type-level API contract mismatches that will cause silent data loss in production. One is a polling bug that will break the core upload→parse→ready UX flow. One is a type error that will fail TypeScript strict compilation. All are fixable in < 2 hours.

---

## Key Fix Verification (Requested by Task Brief)

| Fix | Status | Notes |
|-----|--------|-------|
| `parse_status` field consistent everywhere | ✅ PASS | Model, schema, routes, tasks, frontend all use `parse_status` |
| `get_celery_db()` uses NullPool | ✅ PASS | Creates new engine per task, disposes after. Correct. |
| CORS uses explicit origins list | ✅ PASS | 7 explicit localhost origins, no wildcard |
| jobId is string UUID in frontend | ✅ PASS | `useParams<{ id: string }>()`, used as string throughout |
| candidateId is string UUID in frontend | ⚠️ PARTIAL | Route state is `string \| null` correctly, but `Candidate.id` typed as `number` in api.ts |

---

## P0 — Sprint Blockers (Must Fix Before Sprint 4)

### P0-1: `api.ts` — `Job.id` and `Candidate.id` typed as `number`, should be `string`

**File:** `hr-app/src/types/api.ts`

```typescript
// WRONG — backend returns UUID strings
export interface Job {
  id: number      // ← should be string
  ...
}
export interface Candidate {
  id: number      // ← should be string
  job_id: number  // ← should be string
  ...
}
```

**Why this matters:**
- `CandidatesTab.tsx` calls `setSelectedCandidateId(candidate.id)` where state is `string | null`. TypeScript will error: *"Argument of type 'number' is not assignable to parameter of type 'SetStateAction<string | null>'"*.
- `CandidateDetailModal` receives `candidateId: string` but gets a `number`-typed value passed in.
- `CandidateCard` fallback: `` `Candidate #${candidate.id}` `` — works at runtime but type is wrong.
- `Link to={/jobs/${job.id}}` — works at runtime (UUID stringifies), but the type contract is wrong.

The actual runtime data is correct (UUIDs come through as strings from the backend). But TypeScript strict mode will flag these, and `tsc --noEmit` will fail.

**Fix:** Change both `id: number` → `id: string` and `job_id: number` → `job_id: string`.

---

### P0-2: Experience field name mismatch between frontend and backend

**Files:** `hr-app/src/types/api.ts`, `hr-app/src/components/CreateJobModal.tsx` vs `backend/app/schemas/schemas.py`

**Backend (`JobResponse` / `JobCreate`):**
```python
experience_min: int
experience_max: int
```

**Frontend type (`Job`):**
```typescript
min_experience_years?: number   // ← wrong field names
max_experience_years?: number   // ← wrong field names
```

**Frontend `CreateJobPayload`:**
```typescript
min_experience_years?: number   // ← never reaches backend
max_experience_years?: number   // ← never reaches backend
```

**Impact — two symptoms:**
1. `JobDetailPage.tsx` calls `const { min_experience_years: min, max_experience_years: max } = job` — these will always be `undefined` because the backend returns `experience_min`/`experience_max`. The "X–Y years experience required" subtitle on Job Detail will always be blank.
2. `CreateJobModal.tsx` sends `{ min_experience_years, max_experience_years }` in the POST body — FastAPI's `JobCreate` schema silently ignores unknown fields (Pydantic v2 default is to ignore extras), so experience min/max is never saved to the DB.

**Fix:** Align the frontend types and `CreateJobPayload` with the backend's `experience_min`/`experience_max` naming. Update `JobDetailPage.tsx`'s destructuring accordingly.

---

### P0-3: Candidate polling stops too early — `parsed` and `embedding_done` statuses not covered

**File:** `hr-app/src/components/CandidatesTab.tsx`

```typescript
refetchInterval: (query) => {
  const data = query.state.data
  if (!data || data.length === 0) return false
  return data.some(c =>
    ['pending_parse', 'parsing'].includes(c.parse_status)  // ← MISSING 'parsed' and 'embedding_done'
  ) ? 8000 : false
},
```

**The full pipeline is:** `pending_parse → parsing → parsed → embedding_done → ready`

`parsed` is set by `parse_resume` task on success, before chaining to `generate_candidate_embedding`.  
`embedding_done` is... actually not set anywhere (see P1-5 below), but `parsed` IS set and polling must cover it.

When all candidates have moved from `parsing` to `parsed`, the polling interval becomes `false`. The `generate_candidate_embedding` task then sets status to `ready`, but the frontend never polls again to see it. The user's cards stay stuck on "Parsed" badge indefinitely unless they manually refresh.

**Fix:** Add `'parsed'` and `'embedding_done'` to the polling condition:
```typescript
return data.some(c =>
  ['pending_parse', 'parsing', 'parsed', 'embedding_done'].includes(c.parse_status)
) ? 8000 : false
```

---

### P0-4: Job `status` enum mismatch — backend uses `"active"`, frontend only knows `"open"`

**Files:** `hr-app/src/types/api.ts`, `backend/app/models/models.py`, `backend/app/schemas/schemas.py`

**Backend:**
```python
status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
# JobCreate schema: status: str = "active"
```

**Frontend:**
```typescript
status: 'open' | 'closed' | 'paused'  // ← "active" is not here
```

`CreateJobModal` doesn't send a `status` field at all, so backend defaults to `"active"`. The frontend receives `"active"` from the backend but the type union doesn't include it. The `StatusBadge` falls back to `cfg.open` (showing "Open" for an "active" job), which is a silent UX lie.

The `JobsPage` status filter would also be broken — if a user were to filter by `"open"` they'd get no results because all jobs have status `"active"`.

This needs a decision: standardise on `"active"/"closed"/"paused"` in both places, or `"open"/"closed"/"paused"` in both. Currently neither side matches.

**Fix:** Pick one set of values and align both. Recommended: keep backend values (`active`, `closed`, `paused`) and update frontend type + status badge labels accordingly. Or rename backend default to `"open"` in the Alembic migration default and model default.

---

## P1 — Important (Fix Early Sprint 4)

### P1-1: `CandidateResponse` returns `resume_raw_text` in list endpoint

**File:** `backend/app/schemas/schemas.py`

The `CandidateResponse` schema includes `resume_raw_text: Optional[str]`. The candidate list endpoint (`GET /api/jobs/{job_id}/candidates`) returns this for every candidate. At ~8000 chars per resume and 50 candidates, that's 400KB per list refresh. The candidates list polls every 8 seconds while processing. This needs `resume_raw_text` stripped from the list response.

**Fix:** Create `CandidateListResponse` (without `resume_raw_text`) and `CandidateDetailResponse` (with it). Use the former for the list endpoint.

---

### P1-2: No file size limit on resume upload

**File:** `backend/app/api/routes/candidates.py`

```python
content = await file.read()
dest.write_bytes(content)
```

No limit on file size. A malicious or accidental 100MB upload will OOM the server. Same issue in Google Drive import.

**Fix:** Add a size check: after `content = await file.read()`, raise 422 if `len(content) > 10 * 1024 * 1024` (10MB). Use `UploadFile.size` if available or read with a limit.

---

### P1-3: Filename collision silently overwrites existing resume

**File:** `backend/app/api/routes/candidates.py`

If two candidates upload `john_smith_cv.pdf` for the same job, the second upload overwrites the first file on disk. The first candidate's `resume_file_path` still points to the overwritten file. When text extraction runs, the first candidate gets the second candidate's resume text parsed.

**Fix:** Prefix filename with candidate UUID: `dest = upload_dir / f"{candidate.id}_{filename}"`. Set this before writing.

---

### P1-4: `parse_status` set to `parse_failed` before Celery retry (confusing UX)

**File:** `backend/app/tasks/resume_tasks.py`

On `RateLimitError` and `APIConnectionError`, both `_async_parse` and `_async_embed` set `parse_status = "parse_failed"` before calling `retry()`. So the candidate card shows "Failed" during the retry wait period, then jumps back to active processing on retry. For a user watching the grid, this looks like the system failed and recovered — alarming and confusing.

**Fix:** Use a separate status like `"retry_pending"` or simply keep the previous in-progress status during retries. Only set `"parse_failed"` when `max_retries` is exhausted (check `self.request.retries >= self.max_retries`).

---

### P1-5: `embedding_done` status never set — task chain skips a state

**File:** `backend/app/tasks/resume_tasks.py`

The frontend's `statusConfig` includes an `embedding_done` status with a "Processing" label. However, `generate_candidate_embedding` goes directly from `parsed` → `ready` without ever setting `embedding_done`. The intermediate status is dead UI code. Minor inconsistency, but the frontend will never show the "Processing" badge for embedding.

This is fine for POC but should be cleaned up for Sprint 4 to avoid confusion.

---

### P1-6: Global exception handler exposes internal error details

**File:** `backend/app/main.py`

```python
content={"error": type(exc).__name__, "detail": str(exc)},
```

`str(exc)` can expose stack traces, DB connection strings, internal paths, or OpenAI API key fragments in error messages. For POC this is acceptable, but flag for hardening before any external demo.

---

### P1-7: `react-hot-toast` dependency: docs inconsistency

**File:** `hr-app/package.json`, `hr-app/src/components/CreateJobModal.tsx`, `state.json`

The `state.json` completedTasks says "Removed react-hot-toast dependency entirely" but `package.json` DOES include `"react-hot-toast": "^2.4.1"` and `CreateJobModal.tsx` imports and uses it. The code is consistent (toast is imported and used, package is present). The state.json docs are wrong.

**No code fix needed — doc clarification only.** But Forge should update CONTEXT.md/state.json to reflect that react-hot-toast is present and used in CreateJobModal.

---

## P2/P3 — Notes for Later

### P2-1: `_is_allowed_file` uses OR logic on content-type vs extension

If content-type is spoofed OR extension is `.pdf`/`.docx`, the file passes. A `.exe` renamed to `.pdf` would be accepted. For POC acceptable. Pre-production: require both checks to pass (AND).

### P2-2: `get_celery_db()` creates and disposes a new engine per task

By design (NullPool), but engine creation has overhead. For Sprint 4+, consider a module-level NullPool engine factory (create once, reuse engine object but no connection pooling).

### P2-3: Google Drive import has no per-file size limit

The Drive import streams files without checking size. A 1GB Drive file would stream to disk unchecked. Add a cap matching the direct upload limit.

### P2-4: `CandidateCard` avatar initial could fail on empty `displayName`

`(displayName)[0] ?? '?'` — if `displayName` is an empty string `""`, `displayName[0]` returns `undefined`, so `'?'` kicks in correctly. Works fine. Just noting the edge case is handled.

### P2-5: Job list `Candidates` column always shows `—`

```typescript
{'candidate_count' in job
  ? (job as Job & { candidate_count: number }).candidate_count
  : '—'}
```

The backend `JobResponse` doesn't return `candidate_count`. This column will always show `—`. Consider adding `candidate_count` to `JobResponse` via a subquery in the list endpoint for Sprint 4.

### P3-1: `resume_parser.py` and `embedding_service.py` log using f-strings not lazy `%s` formatting

```python
logger.info(f"Successfully parsed resume. Skills found: {len(parsed.get('skills') or [])}")
```

Best practice for Python logging is `logger.info("...", args)` to avoid unnecessary string interpolation when logging is disabled. Minor style issue.

### P3-2: No `updated_at` on `Candidate` model

The `Candidate` model only has `created_at`. When `parse_status` changes, there's no way to know when it was last updated. Useful for debugging stuck parses. Consider adding `updated_at` in a later migration.

---

## What's Done Well 👍

**Backend:**
- The three-task Celery chain (`extract → parse → embed`) is cleanly separated with correct responsibility boundaries
- Error handling in `resume_tasks.py` is thorough: every failure path is covered, no-retry vs retry decisions are correct (file-not-found = no retry, rate-limit = retry with backoff)
- `get_celery_db()` NullPool pattern is the right solution for the asyncpg/Celery event loop problem — well implemented
- `_get_job_or_404` helper avoids code duplication across the candidates router
- Google Drive graceful degradation (503 when not configured) is clean
- `candidates.py` filename sanitisation via `Path(filename).name` prevents path traversal
- All 6 ORM models have proper `ondelete="CASCADE"` foreign keys
- Alembic migration enables both `uuid-ossp` and `pgvector` extensions cleanly

**Frontend:**
- `BackendError` shared component is a clean pattern — consistent error UX across all query states
- Drive 503 inline fallback (amber banner, not a crash) is exactly right
- `CandidateDetailModal` fetch-by-ID pattern is correct — avoids stale prop data
- FormData interceptor fix (skip Content-Type override) is the right approach for multipart uploads
- Optional chaining on `parsed_data` access is consistent throughout
- No `any` types spotted in the frontend files reviewed

---

## Summary Table

| ID | Severity | File | Issue |
|----|----------|------|-------|
| P0-1 | 🔴 P0 | `hr-app/src/types/api.ts` | `Job.id` / `Candidate.id` / `Candidate.job_id` typed as `number` (should be `string`) |
| P0-2 | 🔴 P0 | `api.ts`, `CreateJobModal.tsx`, `JobDetailPage.tsx` | `min_experience_years`/`max_experience_years` field names don't match backend's `experience_min`/`experience_max` |
| P0-3 | 🔴 P0 | `CandidatesTab.tsx` | Polling stops at `parsing` — misses `parsed` and `embedding_done`, cards never reach `ready` |
| P0-4 | 🔴 P0 | `api.ts`, backend models/schemas | Status enum: backend defaults `"active"`, frontend only handles `"open"/"closed"/"paused"` |
| P1-1 | 🟠 P1 | `schemas.py`, `candidates.py` | `resume_raw_text` returned in list endpoint — large field, performance risk |
| P1-2 | 🟠 P1 | `candidates.py` | No file size limit on resume upload |
| P1-3 | 🟠 P1 | `candidates.py` | Filename collision overwrites existing resume file |
| P1-4 | 🟠 P1 | `resume_tasks.py` | `parse_failed` set before retry — confusing UX flash |
| P1-5 | 🟠 P1 | `resume_tasks.py`, `CandidatesTab.tsx` | `embedding_done` status never set — dead UI state |
| P1-6 | 🟠 P1 | `main.py` | Global exception handler exposes internal error detail |
| P1-7 | 🟡 Doc | `state.json` | react-hot-toast docs inconsistency — package IS present, state.json says it was removed |
| P2-1 | 🟡 P2 | `candidates.py` | File validation uses OR (content-type OR extension) — extension spoofing possible |
| P2-2 | 🟡 P2 | `database.py` | New engine per Celery task (by design, but overhead) |
| P2-3 | 🟡 P2 | `candidates.py` | Drive import: no per-file size limit |
| P2-5 | 🟡 P2 | `JobsPage.tsx`, backend | `candidate_count` always `—` in jobs table |
| P3-1 | ⚪ P3 | `resume_parser.py`, `embedding_service.py` | f-string logging (use `%s` lazy format) |
| P3-2 | ⚪ P3 | `models.py` | No `updated_at` on `Candidate` model |

---

## REVIEW_FAIL

**4 P0 blockers must be fixed before Sprint 4.** Estimated fix time: 1.5–2 hours for Forge + Nova together. All fixes are surgical — no architectural changes needed.

**Recommended fix order:**
1. P0-1: Fix `id` types in `api.ts` (Nova — 10 min)
2. P0-2: Fix experience field names in frontend type + CreateJobModal + JobDetailPage (Nova — 20 min)
3. P0-3: Fix polling interval to include `parsed`/`embedding_done` (Nova — 5 min)
4. P0-4: Align status enum — pick one set of values, update both sides (Forge + Nova — 30 min)
5. P1-3: Fix filename collision (Forge — 10 min) — do this now, it corrupts data silently
