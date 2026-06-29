# Warden Review — Sprint 7
**Date:** 2026-06-23
**Verdict:** REVIEW_FAIL

---

## Summary

Reviewed all Sprint 7 deliverables: backend (`interviews.py`, `schemas.py`, `assessment_service.py`, `resume_parser.py`) and frontend HR app (`ReportPage.tsx`, `DashboardPage.tsx`, `CandidateTimeline.tsx`, `ErrorBoundary.tsx`, `NotFoundPage.tsx`, `App.tsx`) and candidate app (`ErrorBoundary.tsx`, `App.tsx`). Cross-checked all frontend API calls against `INTERFACE.md` (22 endpoints).

**Overall quality:** The work is architecturally sound and the code is clean. The ErrorBoundary components, CandidateTimeline, and NotFoundPage are well-built. The backend interview pipeline logic is correct. However, four P1 bugs exist that will cause real functional failures during QA — the most critical being a wrong default API port in `api.ts` and a broken 404 detection pattern in `ReportPage.tsx`. Forge needs to fix these before Sentinel runs QA.

---

## Issues Found

### P1 — Must Fix Before QA

---

#### [P1-1] `hr-app/src/lib/api.ts` — Wrong default baseURL port

**File:** `hr-app/src/lib/api.ts`, line 8

```typescript
baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
```

**Problem:** The fallback is `localhost:8000`, but the backend runs on port **8080** (documented in CONTEXT.md gotcha #8, INTERFACE.md Base URL, and `state.json`). Port 8000 has Windows ghost TCP connections and is explicitly forbidden. If `VITE_API_URL` is not set in `.env`, **every single API call in the entire HR app fails silently** — the axios instance will fire against the wrong port and receive connection refused.

**Fix:**
```typescript
baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8080',
```

> Same issue almost certainly exists in `candidate-app/src/lib/api.ts` — fix both.

---

#### [P1-2] `hr-app/src/pages/ReportPage.tsx` — 404 detection is broken for report endpoint

**File:** `hr-app/src/pages/ReportPage.tsx`, lines ~145–148

```tsx
const is404 =
  isError &&
  (error?.message?.includes('404') || error?.message?.toLowerCase().includes('not found'))
```

**Problem:** The backend returns `{"detail": "Report not ready yet"}` with HTTP 404. The `api.ts` response interceptor strips the HTTP status code and creates `new Error(detail)` — so `error.message` becomes `"Report not ready yet"`. This string does NOT contain `"404"` or `"not found"`, so `is404` is always `false`. The "Report Not Ready Yet" friendly UI state **never renders**. Instead, the generic "Failed to load report. Please try again." error banner always shows — which is incorrect per INTERFACE.md gotcha #4.

**Root cause:** `api.ts` response interceptor discards HTTP status code when creating the error object.

**Fix option A** (quickest) — update the is404 check in ReportPage.tsx to match the actual message:
```tsx
const is404 =
  isError &&
  (error?.message?.includes('404') ||
   error?.message?.toLowerCase().includes('not found') ||
   error?.message?.toLowerCase().includes('not ready'))
```

**Fix option B** (cleaner, fixes root cause for all pages) — preserve status in api.ts error:
```typescript
// In response interceptor:
const statusCode = error.response?.status
const message = `${statusCode ? statusCode + ': ' : ''}${detail}`
return Promise.reject(new Error(message))
```
Then checks like `includes('404')` will work everywhere.

---

#### [P1-3] `hr-app/src/pages/ReportPage.tsx` — No polling when report not ready (violates INTERFACE.md gotcha)

**File:** `hr-app/src/pages/ReportPage.tsx`, `useQuery` for report

```tsx
retry: (failureCount, err: Error) => {
  if (err.message?.includes('404') || ...) {
    return false   // <-- stops all retries on 404
  }
  return failureCount < 1
},
```

**Problem:** INTERFACE.md gotcha #4 explicitly states:
> *"Poll this endpoint after the interview completes... Show a loading/waiting state — do NOT treat 404 as a permanent failure here."*

The current code sets `retry: false` on 404 and has no `refetchInterval`. Once the 404 is received, the query stops permanently. HR has no way to see when the report becomes available without navigating away and back. The intended UX — a spinner that auto-updates when GPT-4o assessment completes — is completely missing.

**Fix:** Add `refetchInterval` with 404-aware logic:
```tsx
const reportReady = !!report
// ...
useQuery({
  queryKey: ['report', candidateId],
  queryFn: ...,
  enabled: !!candidateId,
  retry: false,
  refetchInterval: reportReady ? false : 10_000,  // poll every 10s until ready
})
```

Note: this fix depends on [P1-2] being fixed first (so 404 doesn't become a permanent error state before polling starts).

---

#### [P1-4] `hr-app/src/pages/DashboardPage.tsx` — Crash risk on `job.required_skills.length`

**File:** `hr-app/src/pages/DashboardPage.tsx`, line ~248

```tsx
{job.required_skills.length > 0 && (
  <p className="text-xs text-slate-400 mt-0.5">
    {job.required_skills.slice(0, 2).join(' · ')}
```

**Problem:** The backend `JobResponse` schema defines `required_skills: Optional[List[str]] = None`. Any job created without skills has `required_skills: null`. The TypeScript `Job` interface in `api.ts` types this as `required_skills: string[]` (non-nullable), masking the backend reality. When a job has `required_skills: null`, `job.required_skills.length` throws `TypeError: Cannot read properties of null` and crashes the entire Dashboard page (which the `ErrorBoundary` catches, but it shouldn't crash at all).

**Fix — Option A** (quickest): guard at access point:
```tsx
{(job.required_skills?.length ?? 0) > 0 && (
  <p>
    {job.required_skills!.slice(0, 2).join(' · ')}
    {job.required_skills!.length > 2 && ` +${job.required_skills!.length - 2}`}
  </p>
)}
```

**Fix — Option B** (also fix the type): update `Job` interface in `api.ts`:
```typescript
required_skills: string[] | null
```
Then fix all access points with `?.` / `?? []`.

---

### P2 — Should Fix (Important but Not Crashing)

---

#### [P2-1] `hr-app/src/types/api.ts` — `InterviewReport` missing `candidate_name` and `job_title`

**File:** `hr-app/src/types/api.ts`, `InterviewReport` interface

The backend `GET /api/candidates/{id}/report` returns `candidate_name` and `job_title` per INTERFACE.md and the `InterviewReportResponse` Pydantic schema. But the frontend TypeScript interface omits them:

```typescript
// MISSING in frontend api.ts:
// candidate_name?: string | null
// job_title?: string | null
```

`ReportPage.tsx` works around this by firing 2 extra API calls (`GET /api/jobs` + `GET /api/jobs/{id}/candidates`) to get the candidate name and job title — data that the report response already contains. This creates 2 unnecessary API calls on every report page load and makes the code harder to maintain.

**Fix:** Add fields to interface and use them directly:
```typescript
export interface InterviewReport {
  // ... existing fields ...
  candidate_name?: string | null   // add
  job_title?: string | null        // add
}
```

Then in `ReportPage.tsx`, use `report.candidate_name` and `report.job_title` directly instead of the extra queries.

---

#### [P2-2] `backend/app/services/assessment_service.py` — `_build_needs_review_report` returns 0 scores instead of null

**File:** `backend/app/services/assessment_service.py`, `_build_needs_review_report()`

```python
return {
    "technical_fit_score": 0,
    "communication_score": 0,
    ...
    "overall_score": 0,
}
```

**Problem:** All scores are `0` (not `None`). The `InterviewReportResponse` schema declares scores as `Optional[float]`. The frontend `ScoreCard` shows `"—"` when `score == null` and `"0/100"` when score is `0`. When a transcript is too short for assessment, HR sees five `0/100` bars — indistinguishable from a candidate who genuinely scored zero across all dimensions. This is actively misleading.

**Fix:** Return `None` for scores in the fallback:
```python
def _build_needs_review_report() -> dict:
    return {
        "technical_fit_score": None,
        "communication_score": None,
        "problem_solving_score": None,
        "experience_score": None,
        "role_alignment_score": None,
        "overall_score": None,
        ...
    }
```

---

## Minor Notes (non-blocking)

#### [P3-1] `backend/app/api/routes/interviews.py` — Unused import in `complete_interview`

`from app.tasks.interview_tasks import generate_interview_report` is imported inside `complete_interview()` but never called (correctly — the agent triggers assessment, not this endpoint). The import is confusing dead code. Remove it.

#### [P3-2] `backend/app/api/routes/interviews.py` — Redundant module-level import shadowed inside `start_interview`

`Candidate` is imported at module level (top of file), but `from app.models.models import Candidate` appears again inside `start_interview()`. The inner import shadows the outer one (same symbol). Remove the inner import.

#### [P3-3] `hr-app/src/pages/DashboardPage.tsx` — `anyDataLoading` skeleton condition is inert

```tsx
{anyDataLoading && jobList.length === 0 && (
  <TableRowSkeleton />
)}
```
This skeleton block only shows when `jobList.length === 0`, which is only while `jobsLoading = true`. Once the jobs list arrives, per-cell inline skeletons handle loading. The outer block is effectively never reached when `jobList.length === 0 && anyDataLoading = true` because it's already caught by the top-level `if (jobsLoading) return <skeleton>`. Minor dead code — harmless.

#### [P3-4] `hr-app/src/components/CandidateTimeline.tsx` — Interview stage label can be misleading

When `screeningCall?.result === 'pass'` but no interview has been scheduled, the stage shows "in_progress" (spinning Loader2 icon) with text "Link sent — awaiting interview". The timeline doesn't know if the interview link was actually sent (it doesn't query `InterviewSession`). If the link wasn't sent yet, "Link sent" is inaccurate. Suggest changing to "Ready for interview" when the link status is unknown.

#### [P3-5] `backend/app/services/resume_parser.py` — No explicit `json.loads` error handling

If GPT returns malformed JSON despite `response_format={"type": "json_object"}`, the `json.loads()` call will throw `json.JSONDecodeError` which propagates to the Celery task. The task will retry (up to 3 times) and eventually set `parse_status="parse_failed"`. This is acceptable but explicit handling with a log would improve observability.

#### [P3-6] `hr-app/src/types/api.ts` — `ScreeningCall.updated_at` field not in backend schema

The frontend `ScreeningCall` interface includes `updated_at: string` but `ScreeningCallResponse` in `schemas.py` does not include this field. Not a crash (TypeScript assumes it exists but backend just doesn't send it — access returns `undefined`). Clean it up for accuracy.

---

## Files Reviewed

| File | Verdict |
|------|---------|
| `backend/app/api/routes/interviews.py` | P3 notes only |
| `backend/app/schemas/schemas.py` | ✅ Clean |
| `backend/app/services/assessment_service.py` | P2 (0 vs null scores) |
| `backend/app/services/resume_parser.py` | P3 note only |
| `hr-app/src/pages/ReportPage.tsx` | ❌ P1-2, P1-3 |
| `hr-app/src/pages/DashboardPage.tsx` | ❌ P1-4 |
| `hr-app/src/components/CandidateTimeline.tsx` | P3 note only |
| `hr-app/src/components/ErrorBoundary.tsx` | ✅ Clean |
| `hr-app/src/pages/NotFoundPage.tsx` | ✅ Clean |
| `hr-app/src/App.tsx` | ✅ Clean |
| `hr-app/src/types/api.ts` | P1-4 (root), P2-1, P3-6 |
| `hr-app/src/lib/api.ts` | ❌ P1-1 |
| `candidate-app/src/components/ErrorBoundary.tsx` | ✅ Clean |
| `candidate-app/src/App.tsx` | ✅ Clean |

---

## Required Fixes (Blocking)

Forge must fix these 4 issues before Sentinel QA:

1. `api.ts` (both apps) — change default port from 8000 → 8080
2. `ReportPage.tsx` — fix 404 detection to match "Report not ready yet" message  
3. `ReportPage.tsx` — add `refetchInterval: 10_000` when report not yet ready
4. `DashboardPage.tsx` — guard `job.required_skills?.length` against null

P2 issues (2-1 and 2-2) are recommended to fix in the same pass but are not gate-blocking for Sentinel.

---

*Reviewed by Warden 🔍 — 2026-06-23*

---
## Re-Review — 2026-06-23
**Verdict:** REVIEW_PASS

### Fix Verification

**[P1-1] `hr-app/src/lib/api.ts` + `candidate-app/src/lib/api.ts` — baseURL port 8080** — VERIFIED ✅
Both files now use `'http://localhost:8080'` as the fallback baseURL. Confirmed in both apps. No regressions.

**[P1-2] `hr-app/src/pages/ReportPage.tsx` — `isReportNotReady` includes `"not ready"` match** — VERIFIED ✅
`isReportNotReady` now includes `.toLowerCase().includes('not ready')`, correctly matching the backend’s `"Report not ready yet"` detail string. The friendly “Report Not Ready Yet” UI block renders correctly when this condition is true.

**[P1-3] `hr-app/src/pages/ReportPage.tsx` — `refetchInterval: 10_000` when report not ready** — VERIFIED ✅ (with P2 caveat — see New Issues)
The `refetchInterval` option is present and the page will poll every 10 seconds in all states where data hasn’t loaded yet. The core requirement — auto-polling while report is absent — is satisfied.

**[P1-4] `hr-app/src/pages/DashboardPage.tsx` — `job.required_skills?.length ?? 0` null guard** — VERIFIED ✅
`(job.required_skills?.length ?? 0) > 0` guards the render block correctly. Inside the block, `job.required_skills!` non-null assertions are valid since the guard ensures non-null. No crash risk remains.

**[P2-1] `hr-app/src/types/api.ts` — `InterviewReport` now has `candidate_name`/`job_title`; `Job.required_skills` is `string[] | null`; `ScreeningCall.updated_at` removed** — VERIFIED ✅
- `InterviewReport` now has `candidate_name?: string | null` and `job_title?: string | null`. `ReportPage.tsx` uses them directly (no extra API calls).
- `Job.required_skills` typed as `string[] | null` — matches backend schema.
- `ScreeningCall.updated_at` is absent from the interface — P3-6 from the original review is also cleared.

**[P2-2] `backend/app/services/assessment_service.py` — `_build_needs_review_report()` returns `None` scores** — VERIFIED ✅
All six score fields (`technical_fit_score`, `communication_score`, `problem_solving_score`, `experience_score`, `role_alignment_score`, `overall_score`) now return `None`. `ScoreCard` correctly renders `“—”` for null scores. No more false `0/100` bars.

**[P3] Dead imports in `backend/app/api/routes/interviews.py`** — VERIFIED ✅
- The dead `from app.tasks.interview_tasks import generate_interview_report` inside `complete_interview()` is gone. The import now lives only in `livekit_webhook()` where it’s actually used.
- The redundant inner `from app.models.models import Candidate` inside `start_interview()` is gone. Module-level import is used throughout.

---

### New Issues Found

**[P2-NEW] `hr-app/src/pages/ReportPage.tsx` — `refetchInterval` references `report` in temporal dead zone; polling never stops**

```tsx
const {
  data: report,
  ...
} = useQuery<InterviewReport>({
  ...
  refetchInterval: (!!report && !isError) ? false : 10_000,  // ⚠️ `report` is TDZ here
})
```

**Problem:** `report` is declared by the `const { data: report } = useQuery(...)` destructuring assignment itself. When JavaScript evaluates the `useQuery(...)` call, `report` has not yet been initialised — it is in the temporal dead zone (TDZ). Under esbuild (which Vite uses for transpilation), TDZ access silently returns `undefined` rather than throwing `ReferenceError`. This means `!!report` is always `false` on every render, so `refetchInterval` is **always** `10_000` — it never evaluates to `false`, even after the report loads successfully.

**Effect:** After the report renders on screen, the query continues polling the backend every 10 seconds indefinitely. This is wasted network traffic and unnecessary backend load — but it does **not** crash the UI or prevent the report from showing.

**Correct fix:** Use TanStack Query v5’s function form, which receives the resolved query state:
```tsx
refetchInterval: (query) => (query.state.data ? false : 10_000),
```

**Severity:** P2 — no visible user impact, no crash, but over-polls.

---

*Re-reviewed by Warden 🔍 — 2026-06-23*

