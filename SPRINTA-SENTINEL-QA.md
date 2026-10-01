# Sentinel QA — Sprint A
**Date:** 2026-06-23
**Agent:** Sentinel 🛡️
**Verdict:** QA_FAIL

---

## Summary

13/14 Sprint A features pass code review. One **P1 bug** found in A-7: the 409 reconnect
detection in `InterviewRoomPage.tsx` is broken because `api.ts` normalises all HTTP errors to
plain `new Error(message)` objects — stripping the HTTP status code — so the `response?.status`
check never matches.

---

## Results by Feature

| # | Feature | File | Result | Notes |
|---|---------|------|--------|-------|
| A-1b | PATCH /api/candidates/{id} — non-None guard | `candidates.py` | ✅ PASS | Guards `phone`, `name`, `email` each with `if body.X is not None`. |
| A-1s | CandidateUpdate schema | `schemas.py` | ✅ PASS | All 3 fields `Optional[str] = None`. Correct. |
| A-1f | CandidateDetailModal — inline phone edit | `CandidateDetailModal.tsx` | ✅ PASS | PATCH `/api/candidates/{id}`, empty-state shows "No phone — click to add", toast fires, both query keys invalidated. |
| A-2 | retry-parse resets to `pending_parse` | `candidates.py` | ✅ PASS | Sets `parse_status = "pending_parse"`, commits, re-queues Celery task. Validates retryable states correctly. |
| A-3 | Dynamic interview URL (uses `CANDIDATE_APP_URL`) | `interviews.py` | ✅ PASS | URL built as `f"{settings.CANDIDATE_APP_URL}/interview/{unique_token}"` (Sprint A fix verified in send + list endpoints). |
| A-4 | GET /jobs/{id}/interviews — candidate_name, no N+1 | `interviews.py` | ✅ PASS | Batch-loads candidates with `Candidate.id.in_(candidate_ids)`. Maps to `candidate_map`. Sets `candidate_name`, `interview_url`, `job_title` for each session. |
| A-5 | InterviewsTab — sessionsMap keyed by candidate_id | `InterviewsTab.tsx` | ✅ PASS | `map[s.candidate_id] = s`. Existing session sets status to `link_sent`/`in_progress`/`completed`/`report_ready` → Send button hidden. |
| A-6 | InterviewLandingPage — 5 states | `InterviewLandingPage.tsx` | ✅ PASS | All 5 states handled: `pending` (full landing), `in_progress` (`RejoinScreen`), `completed` (CompletedScreen), `expired` (`ExpiredScreen`), `invalid/error` (404 screen). Type includes `'expired'`. |
| A-7 | InterviewRoomPage — beforeunload + 409 rejoin | `InterviewRoomPage.tsx` | ❌ FAIL | `beforeunload` guard ✅. **409 detection broken** — see P1 bug below. |
| A-9 | ScreeningTab — confirm dialog before calls | `ScreeningTab.tsx` | ✅ PASS | `showConfirm` gates mutation. Dialog shows `eligibleIds.length` count. Cancel calls `setShowConfirm(false)` only. Mutation only fires in `handleTriggerConfirmed`. |
| A-10 | JobDetailPage — localStorage per-job + ShortlistTab bulk skips decided | `JobDetailPage.tsx`, `ShortlistTab.tsx` | ✅ PASS | Storage key = `shortlist_triggered_${jobId}` — per-job collision prevention confirmed. Bulk approve filters `recommendation==='shortlisted' && hr_decision==='pending'`; bulk reject filters `recommendation==='rejected' && hr_decision==='pending'`. |
| A-11 | CandidatesTab — search by parsed name + status filter | `CandidatesTab.tsx` | ✅ PASS | Filter: `(c.parsed_data?.name ?? c.name ?? '').toLowerCase().includes(search)`. Status filter checks `c.parse_status === statusFilter`. "No results for X" empty state shown. |
| A-12 | ShortlistTab — bulk approve/reject with count toast | `ShortlistTab.tsx` | ✅ PASS | Promise.all PATCH calls. `Loader2` spinner during pending. Toast shows count. `invalidateQueries(['shortlist', jobId])` after. |
| A-13 | expires_at on session + auto-expiry in get_session_by_token | `interviews.py`, `schemas.py` | ✅ PASS | Session created with `datetime.utcnow() + timedelta(days=7)`. Expiry check: `session.expires_at < datetime.utcnow()`, skips if already `completed`/`expired`, commits + refreshes. `expires_at: Optional[datetime]` in `InterviewSessionResponse`. |
| A-14 | JobDetailPage — context-sensitive status dropdown | `JobDetailPage.tsx` | ✅ PASS | `open/active` → Pause/Close; `paused` → Reactivate/Close; `closed` → Reactivate; default → Publish. Click-outside closes via `useRef` + `mousedown` listener. `statusMutation.isPending` spinner. |

---

## Bugs Found

### 🔴 P1 — A-7 · InterviewRoomPage.tsx · 409 detection broken due to api.ts error normalisation

**File:** `candidate-app/src/pages/InterviewRoomPage.tsx`

**Description:**
The 409 reconnect path checks:
```tsx
const status = (err as { response?: { status?: number } })?.response?.status
if (status === 409) {
  setRoomReady(true)
  return
}
```

But `candidate-app/src/lib/api.ts` normalises all HTTP errors to a **plain `new Error(detail)`**,
stripping the original Axios response object:
```ts
// api.ts — response interceptor
return Promise.reject(new Error(detail))
```

The thrown error is `new Error("Interview already started or not in pending state.")` — a plain
`Error` object with no `.response` property. So `response?.status` is **always `undefined`**, and
the `if (status === 409)` branch **never executes**.

**Impact:** When a candidate navigates directly to `/interview/:token/room` after the session has
already started (e.g., back-button then forward, or copy-pasting the URL), the backend returns
409 but the frontend shows the generic "Failed to Connect" error screen instead of the
"Interview Already In Progress" rejoin UI.

**Fix:**
```tsx
// Replace the status-based check with a message-based check:
const msg = err instanceof Error ? err.message : String(err)
if (msg.toLowerCase().includes('already started') || msg.toLowerCase().includes('not in pending')) {
  setRoomReady(true)
  return
}
```

Or preferably, enhance `api.ts` to preserve the HTTP status on thrown errors so all consumers
can check it cleanly:
```ts
// api.ts — attach status to error
const enhancedError = new Error(detail) as Error & { status?: number }
enhancedError.status = error.response?.status
return Promise.reject(enhancedError)
```
Then the InterviewRoomPage check becomes:
```tsx
const status = (err as Error & { status?: number }).status
```

---

### 🟡 P3 — A-11 · CandidatesTab.tsx · Intermediate parse statuses not filterable

**File:** `hr-app/src/components/CandidatesTab.tsx`

**Description:**
The status filter dropdown exposes `ready`, `parsing`, `pending_parse`, `parse_failed` — but the
two intermediate statuses `parsed` and `embedding_done` are not filterable. Candidates stuck in
these states cannot be isolated in the list.

**Severity:** P3 — these are transient states unlikely to linger; not a regression.

**Fix:** Add `<option value="parsed">Processed</option>` and
`<option value="embedding_done">Embedding</option>` to the dropdown.

---

### 🟡 P3 — A-1f · CandidateDetailModal.tsx · Phone field cannot be cleared once set

**File:** `hr-app/src/components/CandidateDetailModal.tsx`

**Description:**
The Save button is disabled when `!phoneInputValue.trim()`, so HR cannot clear an incorrect phone
number by saving an empty value.

**Severity:** P3 — workaround is to overwrite with corrected number. No data loss risk.

**Fix:** Allow empty save with a confirmation prompt or tooltip ("This will remove the phone
number").

---

## Gate Decision

| Check | Status |
|-------|--------|
| P0 bugs | None |
| P1 bugs | **1 found** — A-7 409 detection broken |
| P2 bugs | None |
| P3 notes | 2 (non-blocking) |
| **Verdict** | **QA_FAIL — P1 must be fixed before AUTHORIZED: YES** |

Forge must fix the P1 bug (A-7) then Sentinel will re-verify. P3s can be fixed in a follow-up.
