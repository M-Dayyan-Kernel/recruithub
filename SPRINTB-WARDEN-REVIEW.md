# Warden Review — Sprint B
**Date:** 2026-06-23
**Verdict:** REVIEW_FAIL

---

## Summary

Sprint B delivered 12 tasks across backend (Forge) and frontend (Nova). The backend work is solid — the Redis lock, cascade deletes, dedup guard, and migration are all well-implemented. The frontend is largely clean (no `any` types, correct query invalidations, good UX patterns). One P2 bug was found in `EditJobModal.tsx` that must be fixed before SENTINEL QA. All other findings are P3 non-blocking notes.

---

## Issues Found

### 🔴 P2 — EditJobModal: stale state leaks between open/close cycles

**File:** `hr-app/src/components/EditJobModal.tsx` + `hr-app/src/pages/JobDetailPage.tsx`

**Problem:**  
`EditJobModal` is always mounted when `job` exists (see `JobDetailPage` render):
```tsx
{job && (
  <EditJobModal job={job} open={editOpen} onClose={() => setEditOpen(false)} />
)}
```
The `if (!open) return null` guard inside `EditJobModal` prevents rendering but does **not unmount** the component. All `useState` values persist in memory between open/close cycles.

**Consequence:** If a user:
1. Opens the modal → edits the title to "Something Wrong"
2. Closes without saving
3. Re-opens the modal

...they see "Something Wrong" in the title field instead of the current job title. The modal never resets to the `job` prop values because `useState(job.title)` only runs once at initial mount.

**Fix (one line in JobDetailPage):**  
Change the conditional render from:
```tsx
{job && (
  <EditJobModal job={job} open={editOpen} onClose={() => setEditOpen(false)} />
)}
```
to:
```tsx
{editOpen && job && (
  <EditJobModal job={job} open={editOpen} onClose={() => setEditOpen(false)} />
)}
```
This causes the modal to unmount on close and remount fresh (with current `job` values) on next open.

---

### 🟡 P2 — Redis sync client used in async FastAPI route (acceptable for POC)

**File:** `backend/app/api/routes/shortlist.py`

```python
_r = redis_lib.from_url(settings.REDIS_URL or "redis://localhost:6379/0")
acquired = _r.set(lock_key, "1", nx=True, ex=300)
```

`redis_lib.from_url(...)` uses the synchronous `redis` client. In an `async def` FastAPI handler, this performs **blocking I/O on the event loop thread**, stalling all concurrent requests while the Redis TCP round-trip completes.

The correct pattern is:
```python
import redis.asyncio as aioredis
_r = await aioredis.from_url(settings.REDIS_URL or "redis://localhost:6379/0")
acquired = await _r.set(lock_key, "1", nx=True, ex=300)
await _r.aclose()
```

**Decision for POC:** Flagged P2 but **non-blocking** — with only a handful of concurrent HR users in a POC demo, the event loop stall (a single Redis RTT) is imperceptible. Acceptable for this stage. Track for production hardening.

---

### 🔵 P3 Non-Blocking Notes

**P3-1 — Google Drive import does not set `original_filename`**  
`candidates.py` — `import_resumes_from_drive()` creates `Candidate` records without `original_filename=fname`. Drive-imported files bypass the dedup check on re-upload. Minor inconsistency — dedupe is a B-4 requirement for direct upload only; Drive import is a separate flow. No action required for POC.

**P3-2 — Orphaned disk files on 413 mid-batch**  
`candidates.py` — If a batch of N files is uploaded and file K (K > 1) exceeds 20 MB, files 1 to K-1 have already been written to disk. The `HTTPException(413)` causes the DB transaction to roll back (no Candidate records committed), but the disk files remain. SQLAlchemy correctly rollbacks the DB; cleanup of orphaned uploads is not implemented. Low risk for POC; no user-visible data corruption.

**P3-3 — `strengths` / `gaps` null safety in ShortlistCard**  
`hr-app/src/components/ShortlistTab.tsx` — TypeScript types `strengths: string[]` and `gaps: string[]` as non-nullable, but the backend `Mapped[Optional[List[str]]]` is nullable. If the API ever returns `null`, `result.strengths.slice(0, 3)` and `result.strengths.length` will throw at runtime. In practice, GPT-4o always returns arrays (even empty ones), so this is low risk. Safe guard: `(result.strengths ?? []).slice(0, 3)`.

**P3-4 — CandidateDetailModal stays open after deletion**  
`hr-app/src/components/CandidatesTab.tsx` — The delete mutation does not close the detail modal if it is currently open for the deleted candidate. After deletion the modal will attempt to refresh and encounter a 404. The modal should handle 404 gracefully (it should already show an error state). No crash, minor UX gap.

---

## Files Reviewed

### Backend
| File | Task | Verdict |
|------|------|---------|
| `backend/app/api/routes/candidates.py` | B-4 dedup guard, B-5 size limit, B-9 DELETE | ✅ PASS (P3-1, P3-2 noted) |
| `backend/app/api/routes/shortlist.py` | B-7 Redis lock | ✅ PASS (P2-2 noted) |
| `backend/app/tasks/shortlist_tasks.py` | B-7 lock release in finally | ✅ PASS |
| `backend/app/core/config.py` | REDIS_URL setting | ✅ PASS |
| `backend/app/models/models.py` | original_filename field, cascade deletes | ✅ PASS |
| `backend/alembic/versions/d4f1a2b3c5e6_add_original_filename_to_candidates.py` | Migration | ✅ PASS |

### Frontend HR App
| File | Task | Verdict |
|------|------|---------|
| `hr-app/src/types/api.ts` | SkippedCandidate type, relevant_experience | ✅ PASS |
| `hr-app/src/components/ScreeningTab.tsx` | B-1 skipped banner, B-2 relevant_experience | ✅ PASS |
| `hr-app/src/pages/DashboardPage.tsx` | B-3 error state + retry | ✅ PASS |
| `hr-app/src/components/ShortlistTab.tsx` | B-6 show-all strengths/gaps toggle | ✅ PASS (P3-3 noted) |
| `hr-app/src/components/EditJobModal.tsx` | B-8 edit job form | ❌ FAIL — P2-1 stale state |
| `hr-app/src/pages/JobDetailPage.tsx` | B-8 pencil button + EditJobModal render | ❌ FAIL — P2-1 fix location |
| `hr-app/src/components/CandidatesTab.tsx` | B-9 delete button, B-12 polling back-off | ✅ PASS (P3-4 noted) |

### Frontend Candidate App
| File | Task | Verdict |
|------|------|---------|
| `candidate-app/src/pages/InterviewRoomPage.tsx` | B-10 mobile responsive layout | ✅ PASS |
| `candidate-app/src/pages/InterviewCompletePage.tsx` | B-11 contact info | ✅ PASS |

---

## Detail Notes Per Review Focus

### Redis lock: import, correctness, Windows/async context
- Import: `import redis as redis_lib` — sync library. Works on Windows. Blocks event loop — see P2-2.
- Lock pattern: `nx=True, ex=300` — correct NX (set-if-not-exists) semantics. ✅
- 409 response on lock held: correct. ✅
- `finally` block in `shortlist_tasks.py` releases lock on completion AND on retry. Note: when a task retries (`task_self.retry(...)` raises `celery.exceptions.Retry`), the `finally` block fires, releasing the lock before the retry countdown. This means HR could trigger again while a retry is pending. Acceptable edge case for POC. ✅

### Cascade deletes: DELETE /candidates/{id}
- Model has `cascade="all, delete-orphan"` on `shortlist_results`, `screening_calls`, `interview_sessions`. ✅
- `InterviewSession → InterviewReport` also has `cascade="all, delete-orphan"`. ✅
- All FK definitions include `ondelete="CASCADE"` at DB level as backup. ✅
- `await db.get(Candidate, ...)` + `await db.delete(candidate)` + `await db.commit()` — correct async pattern. ✅

### EditJobModal: changed-fields-only PATCH, type correctness
- PATCH payload builds only changed fields — correctly compares each field against `job` prop values. ✅
- Skills comparison uses `JSON.stringify` for deep equality — correct. ✅
- Number parsing: `minExp ? Number(minExp) : undefined` — avoids sending 0 for empty fields. ✅
- No TypeScript `any` types. ✅
- **Blocking issue:** stale state between open/close cycles — see P2-1.

### Delete candidate: `e.stopPropagation()` correctness
- `onClick={(e) => { e.stopPropagation(); onDelete() }}` on delete button. ✅
- Card `onClick` is only set when `isClickable` (parse_status === 'ready'). For non-ready candidates there's no onClick anyway, but stopPropagation is harmless. ✅

### Mobile layout: md: breakpoints
- `flex flex-col md:flex-row` — correct responsive direction. ✅
- `gap-4 md:gap-6` — responsive gap. ✅
- `w-full md:w-1/2` — full width stacked on mobile, half on desktop. ✅
- `min-w-[44px] min-h-[44px]` — 44px minimum touch targets on control buttons. ✅

### Polling back-off: pollStartTime reset behaviour
- `const [pollStartTime] = useState(() => Date.now())` — per-mount timestamp. ✅
- When user navigates to a new job page, `CandidatesTab` unmounts and remounts, resetting the clock. ✅
- Threshold: first 2 minutes → 5s interval; after 2 minutes → 30s interval. ✅

---

## Required Fix Before QA

Forge must fix **P2-1** only:

**`hr-app/src/pages/JobDetailPage.tsx`** — change the EditJobModal render condition:
```tsx
// BEFORE (always mounted, state leaks between open/close)
{job && (
  <EditJobModal job={job} open={editOpen} onClose={() => setEditOpen(false)} />
)}

// AFTER (unmounts on close, fresh state on each open)
{editOpen && job && (
  <EditJobModal job={job} open={editOpen} onClose={() => setEditOpen(false)} />
)}
```

The `open` prop inside `EditJobModal` is no longer needed once the parent conditionally renders, but removing it is optional cleanup. The fix itself is the one-line change above.

---

*Reviewed by Warden 🔍 — 2026-06-23*
