# Sentinel QA — Sprint B
**Date:** 2026-06-23
**Sentinel:** 🛡️ Sentinel
**Verdict:** QA_PASS

No P0 or P1 blockers found. 1 P2 (memory risk) and 1 P3 (touch target) recorded. Sprint B is cleared for Warden sign-off.

---

## Results

| # | Feature | File | Result | Notes |
|---|---------|------|--------|-------|
| B-1 | Skipped banner only shows when `skipped.length > 0` | `hr-app/src/components/ScreeningTab.tsx` | ✅ PASS | Guard is `{skippedCandidates.length > 0 && ...}` — banner correctly suppressed when empty |
| B-2 | `relevant_experience` field in structured fields grid | `hr-app/src/components/ScreeningTab.tsx` | ✅ PASS | `<FieldRow label="Relevant Exp" value={call.relevant_experience ?? '—'} />` present in grid |
| B-3 | Error state + retry button on DashboardPage | `hr-app/src/pages/DashboardPage.tsx` | ✅ PASS | `isError` + `refetch` destructured; error banner with `AlertCircle` and retry `<button onClick={() => void refetchJobs()}>` rendered above content |
| B-6 | Strengths show-all toggle | `hr-app/src/components/ShortlistTab.tsx` | ✅ PASS | `showAllStrengths` state; `displayStrengths = showAllStrengths ? result.strengths : result.strengths.slice(0, 3)`; `hasMoreStrengths` guard; toggle renders `+ N more` / `− Show less` |
| B-6 | Gaps show-all toggle | `hr-app/src/components/ShortlistTab.tsx` | ✅ PASS | Same pattern: `showAllGaps`, `displayGaps`, `hasMoreGaps`, toggle present and symmetric with strengths |
| B-8 | EditJobModal form pre-populated from `job` prop | `hr-app/src/components/EditJobModal.tsx` | ✅ PASS | All fields initialised from `job`: `title`, `description`, `required_skills`, `experience_min`, `experience_max`, `screening_criteria`, `interview_evaluation_criteria` |
| B-8 | EditJobModal PATCH uses correct endpoint | `hr-app/src/components/EditJobModal.tsx` | ✅ PASS | `api.patch(\`/api/jobs/${job.id}\`, payload)`; invalidates `['job', job.id]` + `['jobs']` |
| B-9 | Delete button has `e.stopPropagation()` | `hr-app/src/components/CandidatesTab.tsx` | ✅ PASS | `onClick={(e) => { e.stopPropagation(); onDelete() }}` — card click-through prevented |
| B-12 | Polling back-off: 5 s → 30 s after 120 s | `hr-app/src/components/CandidatesTab.tsx` | ✅ PASS | `pollStartTime = useState(() => Date.now())`; `elapsed > 120_000 ? 30_000 : 5_000` — thresholds exact |
| B-10 | `md:` breakpoints applied to panel container | `candidate-app/src/pages/InterviewRoomPage.tsx` | ✅ PASS | Container: `flex flex-col md:flex-row`; gap: `gap-4 md:gap-6`; each panel: `w-full md:w-1/2` |
| B-10 | Mic + Camera touch targets ≥ 44 px | `candidate-app/src/pages/InterviewRoomPage.tsx` | ✅ PASS | Both icon buttons have `min-w-[44px] min-h-[44px] w-12 h-12` |
| B-11 | Contact section present on InterviewCompletePage | `candidate-app/src/pages/InterviewCompletePage.tsx` | ✅ PASS | `careers@webknot.in` mailto link with border-top separator present above close-tab note |
| — | `SkippedCandidate` interface in api.ts | `hr-app/src/types/api.ts` | ✅ PASS | `export interface SkippedCandidate { name: string; reason: string }` present |
| — | `relevant_experience` in `ScreeningCall` type | `hr-app/src/types/api.ts` | ✅ PASS | `relevant_experience?: string \| null` present in `ScreeningCall` interface |
| — | Dedup check uses `original_filename` correctly | `backend/app/api/routes/candidates.py` | ✅ PASS | Sanitised `filename = Path(file.filename).name` used for both the dedup query and `candidate.original_filename` — consistent |
| — | DELETE cascade on candidate delete | `backend/app/api/routes/candidates.py` | ✅ PASS | Docstring confirms `cascade='all, delete-orphan'` on related models; `await db.delete(candidate)` triggers cascade |
| — | Redis lock key includes `job_id` | `backend/app/api/routes/shortlist.py` | ✅ PASS | `lock_key = f"shortlist_lock:{job_id}"` — scoped to job, no cross-job collision |
| — | 409 message is clear | `backend/app/api/routes/shortlist.py` | ✅ PASS | `"Shortlisting is already in progress for this job. Please wait."` — actionable |
| — | `finally` block releases Redis lock on failure | `backend/app/tasks/shortlist_tasks.py` | ✅ PASS | `finally:` block executes unconditionally; inner `try/except` prevents lock-release failure from swallowing original exception |

---

## Bugs Found

### P2 — Memory exhaustion before 20 MB guard fires

| | |
|---|---|
| **Severity** | P2 — Medium (POC; no P1 because malicious actors are out of scope for now) |
| **File** | `backend/app/api/routes/candidates.py` — `upload_resumes()` |
| **Description** | The 20 MB size guard (`if len(content) > MAX_FILE_SIZE: raise 413`) fires **after** `content = await file.read()` has fully loaded the file into server RAM. A client sending multiple large files (e.g., 5 × 500 MB) will exhaust server memory before any file is rejected. The guard correctly prevents disk writes and DB inserts for oversized files, but does not protect against in-memory DoS. |
| **Code location** | `candidates.py` lines ~83–90 (inside `for file in files:` loop) |
| **Fix** | Before calling `await file.read()`, inspect the `Content-Length` header or `file.size` attribute (FastAPI 0.95+ exposes `UploadFile.size` when available). Reject early with 413 if size is known. For defense-in-depth, limit total request body size at the ASGI/proxy layer (uvicorn `--limit-max-requests` or nginx `client_max_body_size`). |

---

### P3 — "End Interview" button below 44 px touch target

| | |
|---|---|
| **Severity** | P3 — Minor cosmetic/accessibility |
| **File** | `candidate-app/src/pages/InterviewRoomPage.tsx` — `InterviewRoom` controls row |
| **Description** | The "End Interview" button uses `py-2.5 text-sm` (estimated height ≈ 40 px) without `min-h-[44px]`. The Mic and Camera icon buttons were correctly given `min-w-[44px] min-h-[44px]` but this rectangular text button was missed. On mobile, the tap target is slightly below the 44 px guideline. |
| **Fix** | Add `min-h-[44px]` to the End Interview button's className. |

---

## Non-Blocking Notes

- **EditJobModal state initialisation**: State is seeded from `job` prop at mount only. If `job` changes while the modal is open (highly unlikely in this flow), the form won't reflect the new values. Standard React controlled-form pattern; acceptable for POC.
- **DashboardPage error banner**: Only the `jobs` fetch error is surfaced; per-job `candidateQueries`/`screeningQueries` errors are silently ignored (show `0` counts). Acceptable for a POC dashboard.

---

*Sentinel 🛡️ — Sprint B QA complete — 2026-06-23*
