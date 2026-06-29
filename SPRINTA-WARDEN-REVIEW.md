# Warden Review — Sprint A
**Date:** 2026-06-23
**Reviewer:** Warden 🔍
**Verdict:** ⛔ REVIEW_FAIL

---

## Summary

Sprint A delivered 14 changes across backend and frontend: URL fix for interview links, new GET `/jobs/{id}/interviews` endpoint, retry-parse endpoint, PATCH candidates, expiry logic for interview sessions, phone inline edit, interview sessions fetch in InterviewsTab, screening confirmation dialog, localStorage shortlist persistence, candidate search+filter, bulk approve/reject, and job status dropdown.

**Overall quality is high.** The code is well-structured, TypeScript is clean (no `any`), components are composable, and edge cases are generally handled. However, **one P1 bug was found** in the expires_at expiry check that will cause a 500 crash 7 days after any Sprint A interview session is created. This is a time-bomb that must be fixed before the next sprint.

Two P2 issues (stale cache on bulk action failure, misleading spinner on 409) and four P3 non-blocking notes are also included.

---

## Issues Found

### P1 — Must Fix (blocks next sprint)

#### P1-1: Timezone-naive/aware mismatch in expiry comparison
**File:** `backend/app/api/routes/interviews.py`  
**Lines:** `send_interview_link` (expires_at assignment) + `get_session_by_token` (expiry check)

**Problem:**
```python
# send_interview_link — stores naive datetime
expires_at=datetime.utcnow() + timedelta(days=7),  # ← naive (no tzinfo)

# get_session_by_token — compares naive with aware
if session.expires_at and session.expires_at < datetime.utcnow():  # ← naive
```

`InterviewSession.expires_at` is declared `DateTime(timezone=True)` in the model. asyncpg reads back `TIMESTAMP WITH TIME ZONE` columns as timezone-aware Python datetimes (UTC). Comparing `session.expires_at` (timezone-aware) with `datetime.utcnow()` (timezone-naive) raises:

```
TypeError: can't compare offset-naive and offset-aware datetimes
```

This crashes `GET /api/interview/{token}` with HTTP 500 for **any session that has passed its expiry date.** Since Sprint A sessions expire in 7 days, this will silently break the candidate interview flow exactly 7 days post-creation.

All other datetime operations in this file correctly use `datetime.now(timezone.utc)` — this is the only two that don't.

**Fix:**
```python
# send_interview_link
expires_at=datetime.now(timezone.utc) + timedelta(days=7),

# get_session_by_token
if session.expires_at and session.expires_at < datetime.now(timezone.utc):
```

---

### P2 — Should Fix (not blocking, but degrades UX)

#### P2-1: Bulk actions don't invalidate query cache on partial failure
**File:** `hr-app/src/components/ShortlistTab.tsx`  
**Functions:** `handleApproveAll`, `handleRejectAll`

`queryClient.invalidateQueries` is inside the `try` block, after `await Promise.all`. If any PATCH fails, the `Promise.all` rejects, `invalidateQueries` is never called, and the cache stays stale. Any candidates that were successfully approved/rejected before the failure won't appear updated in the UI until the next auto-refetch (30 s stale time).

```tsx
try {
  await Promise.all(toApprove.map(...))
  queryClient.invalidateQueries({ queryKey: ['shortlist', jobId] })  // ← skipped on failure
  toast.success(...)
} catch {
  toast.error('Failed to approve all. Please try again.')
  // ← invalidateQueries missing here — partial results stay stale
} finally {
  setApprovingAll(false)
}
```

**Fix:** Move `queryClient.invalidateQueries` to a `finally` block (applies to both `handleApproveAll` and `handleRejectAll`).

---

#### P2-2: 409 reconnect screen shows `<Loader2>` spinner on a stable state
**File:** `candidate-app/src/pages/InterviewRoomPage.tsx`

When `POST /api/interview/{token}/start` returns 409 (session already started), the code sets `roomReady=true` and the component renders:

```tsx
if (roomReady && !credentials) {
  return (
    <div ...>
      <Loader2 className="w-10 h-10 text-indigo-400 animate-spin mx-auto mb-4" />  // ← spinning
      <h2>Interview Already In Progress</h2>
      ...
      <button>Rejoin Interview</button>
    </div>
  )
}
```

The spinner implies data is loading, but the screen is fully resolved — there's nothing to wait for. Candidates on poor connections who see a spinner may sit and wait indefinitely rather than clicking "Rejoin Interview."

**Fix:** Remove `<Loader2>` spinner; replace with a static icon (e.g. `<Video>` or `<Info>`) on the 409 screen.

---

### P3 — Non-blocking (informational, can be addressed later)

#### P3-1: Resume download URL hardcodes `localhost:8000` fallback (pre-existing, not fixed in Sprint A)
**File:** `hr-app/src/components/CandidateDetailModal.tsx`

```tsx
const resumeUrl = candidate?.resume_file_path
  ? `${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/uploads/...`
  //                                                 ^^^^ should be 8080
```

Backend runs on 8080 (documented in CONTEXT.md and INTERFACE.md). If `VITE_API_URL` is not set, resume downloads 404. Pre-existing from Sprint 2/3; Sprint A didn't introduce it, but it's still wrong.

---

#### P3-2: CandidatesTab status filter omits `parsed` and `embedding_done` intermediate states
**File:** `hr-app/src/components/CandidatesTab.tsx`

The filter dropdown has: All / Ready / Parsing / Queued / Failed. Missing: `parsed` and `embedding_done`. Candidates mid-pipeline (text extracted, awaiting GPT or embedding) won't match any named filter. They still appear under "All Statuses", so it's not broken — just incomplete.

---

#### P3-3: InterviewsTab makes N+1-style report check per passed candidate
**File:** `hr-app/src/components/InterviewsTab.tsx`  
**Function:** `reportChecks` query

```tsx
await Promise.all(
  passedCandidates.map(async (sc) => {
    await api.get(`/api/candidates/${sc.candidate_id}/report`)
    ...
  })
)
```

One API call per candidate. With 10 passed candidates, this is 10 concurrent GET requests on each 15 s poll cycle. Acceptable for POC (typical numbers are 2–5); would need batching at scale.

---

#### P3-4: `storageKey` uses empty string if `jobId` is undefined
**File:** `hr-app/src/pages/JobDetailPage.tsx`

```tsx
const storageKey = `shortlist_triggered_${jobId ?? ''}`
```

If `jobId` is ever undefined (impossible in practice given router guards), all jobs share the same key. Not a real bug — just defensive coding note.

---

## Security Notes (informational — POC context)

- **PATCH /candidates — open endpoint:** Correct for POC per INTERFACE.md. No auth layer is expected at this stage.
- **`.env` contains live API credentials:** Sprint A only added the safe `CANDIDATE_APP_URL` variable. The existing credentials (OpenAI, Vapi, LiveKit, Resend, Twilio) are pre-existing and must be rotated before production deployment. This is a workspace-local dev file, not a committed artifact — flagged for awareness only.

---

## Correctness vs INTERFACE.md

| Change | INTERFACE.md Match | Notes |
|--------|-------------------|-------|
| `PATCH /api/candidates/{id}` | ✅ | Request/response shapes match exactly |
| `POST /jobs/{id}/candidates/{id}/retry-parse` | ✅ | 202 + `{status, candidate_id}` correct |
| `GET /api/jobs/{id}/interviews` | ✅ | Enriched with `candidate_name`, `interview_url`, `expires_at` |
| `expires_at` on InterviewSessionResponse | ✅ | Optional[datetime], null for old sessions |
| Interview link URL from `CANDIDATE_APP_URL` | ✅ | Config-driven, env var default correct |

---

## TypeScript Quality

All Sprint A frontend changes are clean:
- No `any` types introduced
- Proper generics on mutations (`useMutation<Candidate, Error, string>`)
- `InterviewInfo.status` union correctly extended to include `'expired'`
- `localSession ?? initialSession` pattern is type-safe
- `void handleApproveAll()` correctly used for floating promises in onClick handlers

---

## Files Reviewed

### Backend
- `backend/app/core/config.py` ✅
- `backend/.env` ✅ (safe addition; pre-existing credential concerns noted)
- `backend/app/api/routes/interviews.py` ⚠️ P1 (expiry comparison)
- `backend/app/api/routes/candidates.py` ✅
- `backend/app/schemas/schemas.py` ✅
- `backend/app/models/models.py` ✅
- `backend/alembic/versions/c9d1e2f3a4b5_add_expires_at_to_interview_sessions.py` ✅

### HR App Frontend
- `hr-app/src/components/CandidateDetailModal.tsx` ✅ (P3-1 pre-existing)
- `hr-app/src/components/InterviewsTab.tsx` ✅ (P3-3 minor)
- `hr-app/src/components/ScreeningTab.tsx` ✅
- `hr-app/src/components/ShortlistTab.tsx` ⚠️ P2-1 (bulk action cache)
- `hr-app/src/pages/JobDetailPage.tsx` ✅
- `hr-app/src/components/CandidatesTab.tsx` ✅ (P3-2 minor)

### Candidate App
- `candidate-app/src/pages/InterviewLandingPage.tsx` ✅
- `candidate-app/src/pages/InterviewRoomPage.tsx` ⚠️ P2-2 (409 spinner)

---

## Fix Requirements Before REVIEW_PASS

| Priority | Issue | File | Fix |
|----------|-------|------|-----|
| **P1-1** | datetime.utcnow() vs aware timezone comparison | `interviews.py` | Replace both with `datetime.now(timezone.utc)` |
| P2-1 | invalidateQueries missing in catch (bulk actions) | `ShortlistTab.tsx` | Move to `finally` block |
| P2-2 | Spinner on stable 409 state | `InterviewRoomPage.tsx` | Replace `<Loader2>` with static icon |

Once P1-1 is fixed (P2s optional but recommended), Forge may re-submit for re-review or route directly to Sentinel if Goku judges P2s acceptable for POC.

---

*Warden 🔍 — 2026-06-23*
