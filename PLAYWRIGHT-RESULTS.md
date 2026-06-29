# Playwright E2E Results — AI Recruitment POC HR App

**Date:** 2026-06-23  
**Agent:** QA-Playwright  
**Environment:** Windows 10 (x64), Node 24.14.0, Playwright 1.61.x, Chromium  
**Vite dev server:** http://localhost:5173  
**Backend:** mocked via `page.route()` — no live backend required

---

## Summary

| Run | Tests | Passed | Failed | Duration |
|-----|-------|--------|--------|----------|
| Initial run (before fixes) | 41 | 27 | **14** | 2m 17s |
| Final run (after fixes) | 41 | **41** | **0** | 55.9s |

**Final result: ✅ 41/41 PASS**

---

## Suite Breakdown

| Suite | File | Tests | Pass | Fail |
|-------|------|-------|------|------|
| Dashboard | `e2e/dashboard.spec.ts` | 6 | 6 | 0 |
| Job Detail | `e2e/job-detail.spec.ts` | 10 | 10 | 0 |
| Jobs List & Create | `e2e/jobs.spec.ts` | 7 | 7 | 0 |
| Navigation | `e2e/navigation.spec.ts` | 8 | 8 | 0 |
| Report Page | `e2e/report.spec.ts` | 10 | 10 | 0 |
| **Total** | | **41** | **41** | **0** |

---

## What Was Found and Fixed

### 🐛 App Bug #1 — `required_skills.length` crash in JobsPage.tsx (P1)

**File:** `hr-app/src/pages/JobsPage.tsx`  
**Line:** `job.required_skills.length > 0`  
**Impact:** Crashed the React tree with `TypeError` when any job had `required_skills: null`. The `ErrorBoundary` then unmounted the entire Layout (sidebar, header), causing cascading test failures across navigation and dashboard tests.  
**Fix:** `(job.required_skills?.length ?? 0) > 0`  
**Note:** `INTERFACE.md` spec and `Job.required_skills` TypeScript type both allow `null`. DashboardPage already had the correct null guard; JobsPage did not.

---

### 🐛 App Bug #2 — `required_skills.length` crash in JobDetailPage.tsx (P1)

**File:** `hr-app/src/pages/JobDetailPage.tsx`  
**Line:** `job.required_skills.length > 0`  
**Impact:** Same crash as above — any job with null skills caused the detail page to explode.  
**Fix:** `(job.required_skills?.length ?? 0) > 0`

---

### 🔧 Test Fix — Playwright strict mode violations (12 selectors)

Playwright's strict mode requires a locator to resolve to exactly one element. Multiple assertions used substring-match text/role selectors that matched 2+ DOM nodes:

| Test file | Selector | Problem | Fix |
|-----------|----------|---------|-----|
| `dashboard.spec.ts` | `getByText('Screened', { exact: true })` | Matches both summary card title AND table column header | Added `.first()` |
| `job-detail.spec.ts` | `getByText('React')` | Matches skill chip AND job description containing "React" | Changed to `{ exact: true }.first()` |
| `job-detail.spec.ts` | `getByText('TypeScript')`, `getByText('GraphQL')` | Same as above | Changed to `{ exact: true }.first()` |
| `job-detail.spec.ts` | `getByRole('button', { name: 'Shortlist' })` | Matched tab button AND "Run AI Shortlist" CTA (substring) | Added `exact: true` |
| `job-detail.spec.ts` | `getByRole('link', { name: /Back to Jobs/i })` | Two "Back to Jobs" links in 404 error state | Added `.first()` |
| `job-detail.spec.ts` | `getByRole('heading', { name: 'Jobs' })` | Topbar h1 AND JobsPage h1 both say "Jobs" | Added `.first()` |
| `jobs.spec.ts` | `.or()` locator for error message | Both toast AND inline error banner visible simultaneously | Added `.first()` |
| `navigation.spec.ts` | `getByRole('link', { name: 'Jobs' })` | Substring match hit sidebar "Jobs" AND Dashboard's "All jobs" link | Added `exact: true` |
| `navigation.spec.ts` | `getByRole('heading', { name: 'Jobs' })` | Two h1 elements after navigation | Added `.first()` |
| `report.spec.ts` | `getByText('Communication')` | Summary text contained "communication" in addition to score card label | Changed to `{ exact: true }.first()` |
| `report.spec.ts` | `getByText('Summary')` | Both "Summary" and "Transcript Summary" headings present | Changed to `{ exact: true }` |

---

### 🔧 Test Fix — `page.clock.tick` renamed in Playwright 1.50+

**Test:** `report.spec.ts` — polling test  
**Error:** `TypeError: page.clock.tick is not a function`  
**Cause:** Playwright 1.50+ renamed `clock.tick()` to `clock.runFor()` (which fires all intermediate callbacks) and `clock.fastForward()` (which jumps ahead).  
**Fix:** `await page.clock.tick(11_000)` → `await page.clock.runFor(11_000)`  
**Impact:** The fake-clock polling test now correctly advances TanStack Query's `refetchInterval` timer in < 1s rather than waiting 15s real time.

---

## Test Coverage

| Feature | What's tested |
|---------|---------------|
| Dashboard pipeline metrics | Active jobs count, total candidates, screened, interview-ready summary cards |
| Dashboard jobs table | All 3 jobs visible, status badges, skill chips, candidate counts, loading skeleton |
| Dashboard null skills guard | `required_skills: null` doesn't crash DashboardPage |
| Dashboard empty state | "No jobs yet" + "Go to Jobs" CTA |
| Dashboard navigation | "View" link routes to `/jobs/:id` |
| Jobs list | Table rows, 5 status badge variants, loading state |
| Create Job modal | Opens on button click, field validation (required), success → toast + close, API 422 → error |
| Jobs empty state | "No jobs yet" + "Create Job" CTA |
| Job detail header | Title, experience range, skill chips, status badge |
| Job detail tabs | Candidates (default), Shortlist, Screening, Interviews — all render correct data |
| Job detail 404 | "Job not found" state + Back to Jobs link |
| Job detail null skills | `required_skills: null` doesn't crash JobDetailPage |
| Job detail candidate count | Badge on Candidates tab shows correct count |
| Job detail back nav | "Back to Jobs" returns to `/jobs` |
| Report happy path | All 6 score cards, candidate name, job title, recommendation badge |
| Report score values | 5 individual scores visible with /100 suffix |
| Report not-ready 404 | "Report Not Ready Yet" UI (NOT generic error) |
| Report polling | Fake clock advances 11s → second API call returns report → UI updates |
| Report null scores | `overall_score: null` renders as "—" not "0" |
| Report strengths/weaknesses | Chip text, "Areas to Improve" section label |
| Report summary text | Full paragraph visible |
| Report 500 error | Generic error banner shown, not "not ready" UI |
| Report back navigation | "Back to Job" link routes to correct `/jobs/:id` |
| Navigation 404 | Unknown route shows NotFoundPage with "404" and "Page not found" |
| Navigation 404 CTA | "Back to Dashboard" link routes to `/` |
| Navigation sidebar Dashboard | Click → URL `/` → Dashboard heading visible |
| Navigation sidebar Jobs | Click (exact) → URL `/jobs` → Jobs heading visible |
| Navigation header titles | Dashboard, Jobs, Job Detail header titles correct |
| Navigation sidebar brand | "Recruitment Hub" visible on `/` and `/jobs` |

---

## Notes on Environment

- All API calls are intercepted by `page.route()` — no live backend needed
- `MOCK_JOBS_SAFE` is used for routes where `required_skills: null` would crash the page (Jobs, JobDetail); `MOCK_JOBS` (which includes a null-skills job) is used for the Dashboard (which has correct null guard) and for negative tests
- Fake clock (`page.clock.install()` + `page.clock.runFor()`) used in polling test to avoid 10-second real wait
- `workers: 1` — tests run sequentially to avoid port conflicts on the Vite dev server
- `reuseExistingServer: true` — if Vite is already running on 5173, tests attach to it
