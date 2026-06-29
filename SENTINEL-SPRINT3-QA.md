# SENTINEL-SPRINT3-QA.md
**Agent:** Sentinel 🔎  
**Date:** 2026-06-22  
**Sprint:** 3 — Backend API + Celery + HR App Frontend  
**Method:** Static code analysis — traced critical paths through all source files  

---

## Test Scope

| # | Critical Path | Verdict |
|---|---------------|---------|
| 1 | Job creation — POST /api/jobs shape | ✅ PASS (with caveats) |
| 2 | Resume upload — validation, DB, task enqueue | ✅ PASS |
| 3 | Celery task chain — extract → parse → embed → ready | ⚠️ PARTIAL (see BUG-S3-005) |
| 4 | Candidate list — `parse_status` field name | ✅ PASS |
| 5 | Candidate detail — `parsed_data` shape | ✅ PASS |
| 6 | Frontend: jobId/candidateId UUID type consistency | ❌ FAIL (BUG-S3-002) |
| 7 | Frontend: parse_status badge — all 6 states | ✅ PASS |
| 8 | Frontend: polling stops when all candidates ready | ❌ FAIL (BUG-S3-001) |
| 9 | CORS: explicit origins includes localhost:5173 | ✅ PASS |

---

## Findings Detail

### ❌ BUG-S3-001 — P1 — Polling stops too early, candidates stuck in limbo

**File:** `hr-app/src/components/CandidatesTab.tsx`

**Symptom:** After upload, candidate cards may show "Parsed" or "Processing" forever and never auto-advance to "Ready" without a manual page refresh.

**Root cause:**
```tsx
// Current — only watches pending_parse + parsing
return data.some(c =>
  ['pending_parse', 'parsing'].includes(c.parse_status)
) ? 8000 : false
```

The Celery task chain produces these real status transitions:
1. `pending_parse` → (extract starts) → `parsing`
2. `parsing` → (extraction done, chains to parse_resume) → `parsed`
3. `parsed` → (parse_resume done, chains to generate_candidate_embedding) → `ready`

`parsed` is a real intermediate state that the backend sets. As soon as `extract_resume_text` completes and status flips to `parsed`, the polling condition evaluates to `false` and polling stops. `parse_resume` and `generate_candidate_embedding` may still be running, but the frontend goes quiet and never learns when status reaches `ready`.

**Fix:**
```tsx
return data.some(c =>
  ['pending_parse', 'parsing', 'parsed', 'embedding_done'].includes(c.parse_status)
) ? 8000 : false
```

**Sprint 4 impact:** CRITICAL. Sprint 4 shortlisting runs on `ready` candidates. HR cannot shortlist if the frontend never shows candidates as Ready without a manual refresh.

---

### ❌ BUG-S3-002 — P1 — Job.id and Candidate.id typed as `number` in api.ts

**File:** `hr-app/src/types/api.ts`

**Symptom:** TypeScript type errors at compile time; potential silent bugs in Sprint 4 code that passes IDs to API routes.

**Root cause:**
```ts
// api.ts — WRONG
export interface Job {
  id: number      // ← should be string (UUID)
  ...
}
export interface Candidate {
  id: number      // ← should be string (UUID)
  job_id: number  // ← should be string (UUID)
  ...
}
```

The backend declares all primary keys as `uuid.UUID` (see `models.py`, `schemas.py`) and Pydantic serializes them as UUID strings. The frontend receives e.g. `"3f7b2a1c-..."`, not `42`.

**Current impact in Sprint 3:**
- `CandidatesTab.tsx` calls `setSelectedCandidateId(candidate.id)` where `selectedCandidateId: string | null`. TypeScript sees `number` being assigned to `string | null` — **type error**.
- At runtime it works because JS coerces via template literals, but `tsc --noEmit` will fail.

**Sprint 4 impact:** Sprint 4 will create `ShortlistResult` records and pass `candidate_id` / `job_id` to the shortlist API. If the type is `number` and shortlist code is written expecting the type contract, it could produce incorrect API calls.

**Fix:**
```ts
export interface Job {
  id: string
  ...
}
export interface Candidate {
  id: string
  job_id: string
  ...
}
```

---

### ❌ BUG-S3-003 — P1 — Job experience field names mismatched between backend and frontend

**File:** `hr-app/src/types/api.ts` + `hr-app/src/pages/JobDetailPage.tsx`

**Symptom:** Experience range ("3–5 years experience required") never renders on the Job Detail page. Sprint 4 shortlisting cannot read min/max experience from a job object.

**Root cause:**

Backend `JobResponse` schema (from `schemas.py`):
```python
experience_min: int
experience_max: int
```

Frontend `Job` interface (`api.ts`):
```ts
min_experience_years?: number   // ← wrong name
max_experience_years?: number   // ← wrong name
```

`JobDetailPage.tsx` destructures:
```tsx
const { min_experience_years: min, max_experience_years: max } = job
// Both are undefined → experienceLabel() returns null → experience row never renders
```

**Fix:** Rename frontend fields to match backend:
```ts
export interface Job {
  experience_min: number
  experience_max: number
  ...
}
```
Update `JobDetailPage.tsx` destructure accordingly.

**Sprint 4 impact:** The shortlist prompt will need to know the job's experience requirements. If Sprint 4 reads `job.experience_min` directly from the typed interface, it gets `undefined`.

---

### ⚠️ BUG-S3-004 — P2 — Job status enum mismatch

**File:** `hr-app/src/types/api.ts`

**Backend** default status is `"active"`. CONTEXT.md also references `"draft"`. The `PATCH /{job_id}` endpoint accepts arbitrary strings.

**Frontend** type definition:
```ts
status: 'open' | 'closed' | 'paused'
```

Jobs created from the frontend will have `status: "active"` from the backend. The `StatusBadge` in `JobDetailPage.tsx` handles it gracefully (`?? cfg.open` fallback), so it won't crash. But:
- TypeScript strict mode: `cfg["active"]` would be a type error since `"active"` is not in `Job['status']`
- Jobs in `JobsPage.tsx` status filter won't map correctly if "active" is ever passed as a filter value
- Sprint 4 may try to check `job.status === 'active'` which will never match `'open'`

**Fix:** Align frontend status enum to backend values:
```ts
status: 'active' | 'closed' | 'draft'
```
Update status badge config in `JobDetailPage.tsx` and `JobsPage.tsx` to use `'active'` instead of `'open'`.

---

### ⚠️ BUG-S3-005 — P2 — `embedding_done` status never actually set by backend

**Files:** `backend/app/tasks/resume_tasks.py`

The Candidate type and status badge both include `embedding_done` as a valid status, implying a 4-step pipeline. But resume_tasks.py only produces 3 real states:

| Task | Sets status to |
|------|----------------|
| `extract_resume_text` (start) | `parsing` |
| `parse_resume` (success) | `parsed` |
| `generate_candidate_embedding` (success) | `ready` |

`embedding_done` is never written. It's dead code in both the type definition and the statusConfig. **This is also why BUG-S3-001 is even more severe** — `embedding_done` was supposed to be an intermediate state polled for, but even if it were added to the poll list, it would never trigger.

**Recommended fix (minor):** Either:
- Add `candidate.parse_status = "embedding_done"` before calling `generate_embedding` inside `_async_embed`, OR
- Remove `embedding_done` from the frontend type/statusConfig

---

### ⚠️ BUG-S3-006 — P2 — `resume_raw_text` returned in candidate list response

**File:** `backend/app/schemas/schemas.py`, `candidates.py`

`CandidateResponse` includes `resume_raw_text: Optional[str]`. The list endpoint at `GET /api/jobs/{job_id}/candidates` serializes full ORM objects against this schema.

For a job with 50 candidates each with a 3-page resume, this returns ~750KB of raw text that the frontend immediately discards. The CONTEXT.md Open Questions section already flagged this.

**Fix:** Create a `CandidateListResponse` schema without `resume_raw_text`, use it on the list endpoint only. Keep `resume_raw_text` in `CandidateResponse` for the detail endpoint.

---

### ⚠️ BUG-S3-007 — P2 — Celery retry called without task request context

**File:** `backend/app/tasks/resume_tasks.py`

Inside `_async_parse()` and `_async_embed()` (coroutines, no `self` parameter), retries are triggered via:
```python
raise parse_resume.retry(exc=exc, countdown=300)
raise generate_candidate_embedding.retry(exc=exc, countdown=300)
```

The canonical pattern for `bind=True` tasks is `self.retry()` — this requires the task execution context (`self.request`) to know which task instance to schedule for retry. Calling `task.retry()` as a class-level method may silently fail or use incorrect request context depending on Celery version (4.x vs 5.x behaviour differs).

**Fix:** Thread `task_self` into the async functions or use `.apply_async()` to re-enqueue manually.

---

### ⚠️ BUG-S3-008 — P2 — Drive 503 detection relies on error message string matching

**File:** `hr-app/src/components/CandidatesTab.tsx`

```tsx
if (message.includes('google_drive_not_configured') || status === 503) {
  setDriveNotConfigured(true)
}
```

The `status === 503` check provides a safety net and is likely sufficient. The string match is fragile (Axios may wrap the response body differently), but the status code check covers the main case. This is low risk but worth noting for robustness.

---

### ✅ Passing Checks

**POST /api/jobs shape:**
- Returns `JobResponse` with `id: uuid.UUID`, all required fields ✅
- Status 201 on success ✅
- `JobCreate` validates title/description required ✅

**Resume upload:**
- File type validation (content-type + extension check, OR logic is deliberate for browser reliability) ✅
- 422 on bad file type ✅
- 404 if job doesn't exist (checked before disk write) ✅
- `parse_status` set to `"pending_parse"` on create ✅
- `extract_resume_text.apply_async()` enqueued for each candidate ✅
- Status 202 Accepted returned ✅

**Celery task chain logic (ignoring BUG-S3-005/007):**
- File-not-found → no retry, `parse_failed` ✅
- Candidate-not-found → log + early return (no crash) ✅
- OpenAI auth error → no retry, `parse_failed` ✅
- Rate limit → retry with 300s backoff ✅ (though see BUG-S3-007)
- On success: status transitions are correct, contact fields back-filled ✅

**Candidate list field names:**
- `parse_status` used correctly throughout model, schema, tasks, routes (Goku's 2026-06-22 fix verified) ✅

**Candidate detail `parsed_data` shape:**
- GPT-4o extracts: name, email, phone, skills, total_experience_years, experience[], education[], current_company, current_role
- Frontend `ParsedData` interface matches exactly ✅
- All fields optional/nullable ✅

**parse_status badge — all 6 states:**
```tsx
statusConfig = {
  pending_parse: ✅
  parsing: ✅
  parsed: ✅
  embedding_done: ✅ (dead code, but won't crash)
  ready: ✅
  parse_failed: ✅
}
```
All 6 states handled. Typed as `Record<Candidate['parse_status'], ...>` so TypeScript will flag missing states if any are added ✅

**CORS:**
- Explicit origins list — `allow_credentials=True` with explicit origins (not wildcard) is correct ✅
- `localhost:5173` included ✅
- Ports 5174–5178 also covered ✅

---

## Bug Summary

| ID | Severity | File | Description |
|----|----------|------|-------------|
| BUG-S3-001 | **P1** | CandidatesTab.tsx | Polling stops at `parsing` — misses `parsed` and `embedding_done` states |
| BUG-S3-002 | **P1** | api.ts | `Job.id` and `Candidate.id` typed as `number` — should be `string` (UUID) |
| BUG-S3-003 | **P1** | api.ts + JobDetailPage.tsx | `min_experience_years`/`max_experience_years` ↔ `experience_min`/`experience_max` mismatch |
| BUG-S3-004 | P2 | api.ts | Status enum `'open'/'closed'/'paused'` ↔ backend `'active'/'closed'/'draft'` |
| BUG-S3-005 | P2 | resume_tasks.py | `embedding_done` status never set by backend — dead code |
| BUG-S3-006 | P2 | schemas.py + candidates.py | `resume_raw_text` in list response — unnecessary bandwidth |
| BUG-S3-007 | P2 | resume_tasks.py | `task.retry()` called without task context in async functions |
| BUG-S3-008 | P2 | CandidatesTab.tsx | Drive 503 detection uses string matching (fragile; status code check is sufficient) |

---

## Sprint 4 Readiness Assessment

Sprint 4 is **AI Shortlisting** — runs GPT against `ready` candidates and stores `ShortlistResult`.

| Requirement | Status |
|-------------|--------|
| Candidates can reach `ready` status | ❌ Blocked (BUG-S3-001 — polling stops before ready) |
| `candidate.id` is a correct UUID string | ⚠️ Runtime works, TypeScript fails (BUG-S3-002) |
| `job.experience_min/max` readable from frontend Job object | ❌ Field names wrong (BUG-S3-003) |
| Job status distinguishable (active vs closed) | ⚠️ Display falls back, logic may fail (BUG-S3-004) |

Sprint 4 should not start until BUG-S3-001, BUG-S3-002, and BUG-S3-003 are fixed. BUG-S3-001 is the most critical — without it, HR cannot confirm candidates are `ready` without manual refresh, making the shortlisting trigger unusable in practice.

---

## Verdict

```
QA_FAIL

P1 bugs (3):
  BUG-S3-001: Polling stops before candidates reach 'ready' — CandidatesTab.tsx refetchInterval 
              only watches ['pending_parse', 'parsing'], misses 'parsed' state
  BUG-S3-002: Job.id and Candidate.id typed as number in api.ts — TypeScript type errors,
              Sprint 4 ID contract incorrect
  BUG-S3-003: Experience field names mismatched (min_experience_years vs experience_min)
              — experience never displays, Sprint 4 shortlisting reads undefined

P1 fixes are small and targeted. Recommend Forge patch before Sprint 4 spawn.
```
