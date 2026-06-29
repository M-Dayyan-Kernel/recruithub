# Sentinel QA Report — Sprint 7
**Date:** 2026-06-23
**Verdict:** QA_PASS

---

## Summary

All Sprint 7 deliverables reviewed by static code inspection. All four P1 issues and both P2 issues identified by Warden's initial review have been correctly fixed by Forge. The additional P2-NEW issue (polling TDZ) flagged in Warden's re-review has also been correctly resolved using TanStack Query v5's function form. No new P0 or P1 bugs found. Three P3 notes recorded — all minor/cosmetic.

---

## Test Results

### Backend

#### `backend/app/api/routes/interviews.py` ✅ PASS

- **Join logic for candidate_name / job_title:** `get_interview_report` correctly fetches `Candidate` and `Job` via separate async queries, builds a dict via `{col.key: getattr(report, col.key) for col in report.__table__.columns}`, merges `candidate_name` and `job_title`, then calls `InterviewReportResponse.model_validate(report_dict)`. Dict-merge pattern avoids Pydantic v2 model re-validation issues.
- **404 message:** `raise HTTPException(status_code=404, detail="Report not ready yet")` — exact match to what `ReportPage.tsx` checks for (`includes('not ready')`).
- **Dead imports (P3-1, P3-2):** Confirmed clean. No inner `generate_interview_report` import inside `complete_interview`. No redundant inner `Candidate` import inside `start_interview`. Module-level imports are used throughout.

#### `backend/app/schemas/schemas.py` ✅ PASS

- `InterviewReportResponse` has all expected fields: `id`, `interview_session_id`, `candidate_id`, `job_id`, `summary`, `transcript_summary`, `technical_fit_score`, `communication_score`, `problem_solving_score`, `experience_score`, `role_alignment_score`, `overall_score`, `strengths`, `weaknesses`, `jd_fit`, `final_recommendation`, `raw_report`, `created_at`, `candidate_name`, `job_title`. All score fields are `Optional[float]` — correctly nullable.
- `candidate_name: Optional[str] = None` and `job_title: Optional[str] = None` present as enriched fields outside the ORM model.

#### `backend/app/services/assessment_service.py` ✅ PASS

- `_build_needs_review_report()` returns `None` for all six score fields: `technical_fit_score`, `communication_score`, `problem_solving_score`, `experience_score`, `role_alignment_score`, `overall_score`. This is correct — `ScoreCard` renders `"—"` for null, not `"0/100"`.
- `generate_assessment()` defensive key validation for missing keys uses `0` for score keys as fallback from the GPT response — this only applies to malformed GPT output, not the fallback path. Acceptable.

---

### Frontend

#### `hr-app/src/pages/ReportPage.tsx` ✅ PASS

- **404 detection / isReportNotReady:** Includes `.toLowerCase().includes('not ready')` → correctly matches backend's `"Report not ready yet"` error message.
- **Polling logic:** Uses TanStack Query v5 function form `refetchInterval: (query) => (query.state.data ? false : 10_000)`. This avoids the TDZ issue flagged in Warden's P2-NEW. Polling stops when `query.state.data` is truthy (report loaded), polls every 10s while not ready.
- **Score display:** `ScoreCard` shows `—` when `score != null` is false (handles both `null` and `undefined`). Correct.
- **candidate_name / job_title:** Header card uses `report.candidate_name` and `report.job_title` directly from the report response. No extra API calls for candidate/job data.
- **retry: false:** Correctly set — 404 won't permanently dead-end (polling continues via `refetchInterval`).

**P3 note — ScoreBar renders with 0% width for null scores:** `ScoreBar` accepts `score: number | undefined` but receives `null` at runtime from needs_review reports. `null ?? 0` = 0, so bar width = 0% (invisible). Display correctly shows `—`. No visual bug to the user, but a minor type mismatch. Non-blocking.

#### `hr-app/src/pages/DashboardPage.tsx` ✅ PASS

- **required_skills null guard:** `(job.required_skills?.length ?? 0) > 0` correctly guards the render block. Inside the block, `job.required_skills!.slice(0, 2)` and `.length` use non-null assertion, valid since the guard ensures non-null. No crash risk.
- **Job type:** `required_skills: string[] | null` in `api.ts` — matches backend `Optional[List[str]]`. Correct.
- **anyDataLoading / skeleton condition:** P3-3 from Warden noted but harmless — `anyDataLoading && jobList.length === 0` skeleton block is unreachable after jobs load. No functional impact.

#### `hr-app/src/components/CandidateTimeline.tsx` ✅ PASS

- **Stage 1 (Uploaded):** Always `'success'` — correct.
- **Stage 2 (Parsed):** Correctly maps `parse_status`: `ready`→success, `parse_failed`→fail, `parsing/parsed/embedding_done`→in_progress, else→pending.
- **Stage 3 (AI Shortlisted):** Correctly looks up `shortlistResult` from cached query by `candidate_id`. Maps `shortlisted`→success, `rejected`→fail, else→in_progress.
- **Stage 4 (Voice Screened):** Correctly handles all `call_status` values including `completed+pass`, `completed+fail`, `completed` (needs_review), `initiated/in_progress`. No crash path.
- **Stage 5 (Interview):** `report ? 'success' : screeningCall?.result === 'pass' ? 'in_progress' : 'pending'` — logic correct.
- **Stage 6 (Assessment):** `report ? 'success' : 'pending'` — correct. `report.overall_score != null` guard before displaying score.
- All 6 stages rendered. Stage emoji, dot colour, label colour, connector colour — all use correct StatusDot/StatusConnector/StatusLabel maps.

**P3 note — Stage 5 "Link sent — awaiting interview" text:** `interviewDetail` says "Link sent — awaiting interview" when `screeningCall?.result === 'pass'` but no report. The component doesn't query `InterviewSession` to confirm link was actually sent — this is noted in Warden's original P3-4. The text could be slightly inaccurate if link wasn't sent yet. Cosmetic/edge-case only.

#### `hr-app/src/components/ErrorBoundary.tsx` ✅ PASS

- Class component with correct `getDerivedStateFromError` and `componentDidCatch` lifecycle methods.
- Renders fallback UI on error: `AlertTriangle` icon, "Something went wrong" heading, "Reload page" button.
- Shows error stack trace in `import.meta.env.DEV` mode only.
- Light theme (`bg-white`, `text-slate-900`) appropriate for HR app.

#### `hr-app/src/pages/NotFoundPage.tsx` ✅ PASS

- Renders `SearchX` icon, "404" label, "Page not found" heading, description text, "Back to Dashboard" `<Link to="/">`.
- Clean minimal UI. Works as a catch-all 404 page.

#### `hr-app/src/App.tsx` ✅ PASS

- `<ErrorBoundary>` wraps all content (Routes + Toaster).
- `<Toaster>` present (position: top-right, 4s duration).
- Routes: `/` → DashboardPage, `/jobs` → JobsPage, `/jobs/:id` → JobDetailPage, `/jobs/:jobId/candidates/:candidateId/report` → ReportPage, `*` → NotFoundPage.
- 404 catch-all `<Route path="*" element={<NotFoundPage />} />` present and correctly placed last.

#### `candidate-app/src/App.tsx` ✅ PASS

- `<ErrorBoundary>` wraps all content.
- `<Toaster>` present (position: top-center, 4s duration).
- Routes: `/interview/:token`, `/interview/:token/room`, `/interview/:token/complete`.
- Catch-all `<Route path="*" element={<Navigate to="/interview/demo" replace />} />` present — navigates to demo token (renders invalid token state gracefully).

#### `hr-app/src/lib/api.ts` ✅ PASS

- `baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8080'` — correct port.
- FormData guard in request interceptor: `if (!(config.data instanceof FormData))` — correct, avoids overriding multipart Content-Type.
- Response interceptor extracts `detail` → `message` → `error.message` and rejects with `new Error(detail)`.

#### `candidate-app/src/lib/api.ts` ✅ PASS

- `baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8080'` — correct port.
- Request interceptor: no FormData guard (candidate-app doesn't do file uploads — not needed).
- Response interceptor: same error normalisation pattern as hr-app.

#### `hr-app/src/types/api.ts` ✅ PASS

- `InterviewReport` has `candidate_name?: string | null` and `job_title?: string | null`.
- `Job.required_skills: string[] | null` — matches backend `Optional[List[str]]`.
- `ScreeningCall.updated_at` absent — P3-6 from Warden's original review is clean.
- All other types reviewed: `ShortlistResultWithCandidate`, `ScreeningCall`, `InterviewSession`, `Candidate` — all correct and consistent with backend schemas.

---

### Integration Logic

#### Does `ReportPage.tsx` use `report.candidate_name` / `report.job_title` directly? ✅ PASS

Yes. The header card renders `report.candidate_name ?? 'Interview Report'` and `report.job_title`. No secondary `GET /api/jobs` or `GET /api/jobs/{id}/candidates` queries are fired in `ReportPage.tsx`. Single query: `GET /api/candidates/${candidateId}/report`.

#### Does `DashboardPage.tsx` safely handle jobs with null `required_skills`? ✅ PASS

Yes. `(job.required_skills?.length ?? 0) > 0` optional chaining + nullish coalescing guards the entire render block. No crash path on null.

#### Does `ReportPage.tsx` poll every 10s when report isn't ready, and stop when it loads? ✅ PASS

Yes. `refetchInterval: (query) => (query.state.data ? false : 10_000)`:
- While no data: returns `10_000` → polls every 10 seconds.
- Once data arrives: returns `false` → polling stops.
- TanStack Query v5 function form avoids the `report` TDZ issue. Correct implementation.

---

## Bugs Found

### P3 Notes (non-blocking)

| # | File | Note |
|---|------|------|
| P3-A | `hr-app/src/pages/ReportPage.tsx` | `ScoreBar` renders 0-width (invisible) bar for null scores from `_build_needs_review_report`. Display correctly shows `—`. Cosmetic — runtime type mismatch (`null` vs `undefined`) with no visible UX impact. |
| P3-B | `hr-app/src/components/CandidateTimeline.tsx` | "Link sent — awaiting interview" label shown whenever `screeningCall.result === 'pass'` regardless of whether link was actually sent. Known P3-4 from Warden. |
| P3-C | `hr-app/src/pages/DashboardPage.tsx` | `anyDataLoading && jobList.length === 0` skeleton block is unreachable (Warden P3-3). Dead code, harmless. |

---

*Reviewed by Sentinel 🛡️ — 2026-06-23*
