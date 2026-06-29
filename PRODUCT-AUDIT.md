# Product Audit — AI Recruitment POC
**Date:** 2026-06-23
**Auditor:** Hermes 🧭
**Files reviewed:** CONTEXT.md, INTERFACE.md, App.tsx (both apps), api.ts, DashboardPage, JobDetailPage, CandidatesTab, ShortlistTab, ScreeningTab, InterviewsTab, ReportPage, InterviewLandingPage, InterviewRoomPage, InterviewCompletePage, candidates.py, interviews.py

---

## Executive Summary

The AI Recruitment POC is a well-structured 7-sprint product with solid foundations — clean component design, consistent error/loading states, and a working end-to-end pipeline from resume upload to interview report. The core happy path functions. However, **five issues block real-world use**: the lack of phone number editing means screening is impossible for many candidates, interview links are hardcoded to `localhost`, the candidate reconnect flow is broken, session state is lost on page refresh, and parse-failed candidates are permanently stuck. Beyond those blockers, there are 10 high-priority gaps (missing endpoints, score display discrepancy, no job management UI) and a range of medium and polish issues. Sprint A (P0+P1) is an estimated 8–10 dev days. Sprint B (P2) is a further 3–4 days.

---

## HR App — Issues Found

### P0 — Blocker (breaks core workflow)

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| P0-1 | `ScreeningTab` + Backend | **No way to add/edit candidate phone number.** If resume has no phone, candidate shows "No phone" warning and is permanently excluded from screening. There is no PATCH `/api/candidates/{id}` endpoint and no UI input to manually add a phone. | Entire screening pipeline blocked for any candidate whose resume lacks a phone number. Kills screening for real-world resumes (40–60% skip phone). |
| P0-2 | `CandidatesTab` + Backend | **No retry for `parse_failed` candidates.** When parsing fails, the card shows a red "Failed" badge with no action button. No backend endpoint exists to re-trigger `extract_resume_text`. Candidate is permanently stuck. | Any transient OpenAI error or file issue permanently loses the candidate record with no recovery path. |
| P0-3 | `InterviewsTab` | **Interview session URL lost on page refresh.** `CandidateInterviewCard` stores the session in local React state only (`useState<InterviewSession | null>`). After sending, if HR refreshes the page or returns later, the interview URL is gone. The `GET /api/jobs/{job_id}/interviews` endpoint does not exist in the backend to recover it. | HR cannot retrieve the interview link after a page refresh — the candidate has to be re-invited, which would create a 409 conflict. Link is effectively unrecoverable. |
| P0-4 | `interviews.py` (backend) | **Interview URL hardcoded to `localhost:5174`.** Line: `interview_url = f"http://localhost:5174/interview/{unique_token}"`. Candidates receive localhost URLs that don't work outside the developer's machine. | Every interview email sent in a staging or production environment delivers a broken, unclickable link. Complete blocker for any non-local demo. |

---

### P1 — High (significant friction)

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| P1-1 | Backend (`interviews.py`) | **`GET /api/jobs/{job_id}/interviews` endpoint is missing.** Mentioned in CONTEXT.md sprint 6 delivery and in INTERFACE.md quick reference, but not implemented in `interviews.py`. Only per-candidate endpoints exist. | InterviewsTab cannot load existing sessions after page refresh. No way to list all interview sessions for a job without this endpoint. |
| P1-2 | `ReportPage.tsx` | **Score display assumes 0–100 but INTERFACE.md documents scores as 0–10.** `ScoreBar` uses `pct = score` directly as a CSS percentage (`style={{ width: \`${pct}%\` }}`). If GPT returns 7/10, the bar renders 7% wide and the label reads "7/100". Colour thresholds (≥70 green, ≥40 amber) also only make sense for 0–100. | Every interview report shows near-empty progress bars and confusingly low scores. HR cannot interpret candidate quality from the report page. |
| P1-3 | `ShortlistTab.tsx` | **`shortlistTriggered` state is lost on page refresh or tab switch.** The flag lives in `JobDetailPage` React state. If HR triggers shortlisting, switches tabs, or refreshes while the Celery task runs, `shortlistTriggered` resets to `false`. ShortlistTab then shows "No shortlist yet" with no spinner — HR doesn't know if it's still running or failed. | Confusing UX: HR re-triggers shortlisting (wasting tokens), or thinks it failed when it's actually running. |
| P1-4 | `InterviewLandingPage.tsx` (candidate app) | **`in_progress` session shows "Interview Already Completed".** The page checks `if (info.status !== 'pending')` and shows the "completed" screen for all non-pending states — including `in_progress`. A candidate who lost their connection mid-interview sees "already completed" with no way to rejoin. | Disconnected candidate cannot continue the interview. They'd have to contact HR who has no mechanism to reset the session either. |
| P1-5 | `InterviewLandingPage.tsx` (candidate app) | **`expired` status missing from frontend TypeScript type.** `InterviewSession.status` is typed as `'pending' | 'in_progress' | 'completed'` — `expired` is absent. If the backend sets status to `expired`, the frontend misses it and shows "Interview Already Completed" instead of a purpose-built expiry message. | Expired candidates see wrong copy and no explanation — silent UX failure. |
| P1-6 | HR App (all tabs) | **No job status management UI.** There's no button to pause, close, or reactivate a job. The `PATCH /api/jobs/{id}` endpoint supports status updates but no UI surface exists. | HR cannot close a job when hiring is complete, or pause it temporarily. Pipeline metrics become inaccurate as filled roles stay "Active". |
| P1-7 | `ScreeningTab` → `TriggerSection` | **No confirmation dialog before triggering AI screening calls.** Clicking "Start AI Screening" immediately initiates live Vapi calls (billing events) with zero confirmation. A single misclick on a large batch is irreversible. | Accidental calls waste Vapi credit. Candidates receive unexpected calls outside business hours. No undo. |
| P1-8 | `CandidateInterviewCard` | **Send interview link 409 error message is unhelpful.** If a session already exists (409), the error shows "Failed to send interview link." — with no context. HR doesn't know the session exists and the link was already sent. | HR panics and re-tries repeatedly; link URL is not surfaced; manual intervention needed. |
| P1-9 | `CandidatesTab.tsx` | **No search or filter for candidate list.** With 30+ resumes uploaded, there is no way to search by name, filter by `parse_status`, or sort. Candidates are displayed in creation order only. | Unusable for any job with more than ~20 candidates. HR has to visually scan the entire grid. |
| P1-10 | `ShortlistTab.tsx` | **No bulk approve / reject action.** HR must click Approve or Reject per card, one at a time, for potentially 40+ candidates. No "Approve all shortlisted" or multi-select. | Reviewing a large shortlist is exhausting — the UI is not a productivity tool at scale. |

---

### P2 — Medium (noticeable but workable)

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| P2-1 | `ScreeningTab` → `TriggerSection` | **Skipped candidates (no phone) not surfaced after trigger.** The API returns `{ initiated, skipped: [{name, reason}] }` but the frontend only toasts the `initiated` count. The skipped list (with reasons) is silently discarded. | HR doesn't know which candidates were skipped and can't take action (e.g., add phone manually). |
| P2-2 | `ScreeningResultCard` | **"Relevant Experience" field missing from result card.** `ScreeningCall.relevant_experience` exists in the API response but is not rendered in the structured fields grid (CTC, Notice Period, Availability, Location, Willingness, Communication). | HR loses a key screening data point — how much relevant experience the candidate claimed on the call. |
| P2-3 | `DashboardPage.tsx` | **Dashboard has no error state.** If the jobs API fails, `jobsLoading` stays false, `jobList` remains `[]`, and the UI renders the "No jobs yet" empty state — visually identical to a real empty state. No error banner is shown. | HR thinks there are no jobs instead of recognising an API failure. |
| P2-4 | `DashboardPage.tsx` | **"Interview Ready" KPI card counts candidates who passed screening, not those who completed interviews.** The metric uses `passedScreening` (result=pass from screening call) as the "Interview Ready" count. This is correct by label, but the metric doesn't update as interviews actually complete. A "Completed Interviews" metric is missing entirely from the dashboard. | Dashboard pipeline view is incomplete — no visibility into actual interview completions from the KPI row. |
| P2-5 | Backend (`candidates.py`) | **No duplicate resume detection.** Uploading the same candidate twice (different filename, same email) creates two `Candidate` records. Shortlisting will score the duplicate too, creating a confusing dual-entry in ShortlistTab. | Inflated candidate counts; HR reviews the same person twice. |
| P2-6 | Backend (`interviews.py`) | **No interview link expiry mechanism.** Sessions stay `pending` indefinitely. There's no cron/task to set status to `expired` after N days. A candidate opening a stale 6-month-old link will see the same "Start Interview" screen as a fresh one. | Stale interview sessions pollute the pipeline. No way to distinguish fresh vs. expired invitations. |
| P2-7 | Backend (`candidates.py`) | **No file size limit enforced on upload.** `content = await file.read()` loads the entire file into memory with no size check. A 100 MB PDF would silently bloat memory and potentially crash the FastAPI worker. | Service instability under adversarial or accidental large file uploads. |
| P2-8 | `ShortlistTab` → `ShortlistCard` | **Strengths and gaps capped at 3 with no "show all" toggle.** `displayStrengths = result.strengths.slice(0, 3)`. If GPT returns 6 strengths, 3 are permanently hidden — unlike the "Show more" for the reason text. | HR makes decisions on partial AI output without knowing the full picture. |
| P2-9 | Backend (`shortlist.py`) | **No lock against concurrent shortlisting.** Two HR users (or a double-click on a slow connection) can both fire `POST /api/jobs/{job_id}/shortlist` simultaneously, spinning up two Celery tasks. The upsert preserves `hr_decision` but re-scoring runs twice, wasting tokens. | Token waste and potential race conditions on the upsert when two GPT calls complete at the same time for the same candidate. |
| P2-10 | `JobDetailPage.tsx` | **No way to edit job details after creation.** The job header card shows all fields (title, description, skills, experience range) as read-only. The `PATCH /api/jobs/{id}` endpoint is available but no "Edit" button or modal exists. | Typos or spec changes require deleting and recreating the job (losing all candidates). |

---

### P3 — Low (polish)

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| P3-1 | `CandidatesTab` | Polling interval is 8s for all statuses. For large batches (50+ candidates), this means 50+ API calls every 8s until all are parsed. Should back-off to 15–30s after first minute. | Unnecessary load on backend. |
| P3-2 | `InterviewsTab` | `reportChecks` query fires N parallel `GET /api/candidates/{id}/report` calls every 15s per passed candidate. For 10+ candidates this is very chatty. | 30+ API calls per minute during the interview phase. |
| P3-3 | `JobDetailPage.tsx` | Long job descriptions not truncated in the header card. Very verbose descriptions push tab content far down the page. | Minor layout issue but affects scannability. |
| P3-4 | `CandidateCard` | When `displayName = 'Parsing...'`, avatar initial renders as 'P'. Should show a spinner icon instead. | Minor visual oddity — first impression issue. |
| P3-5 | `ReportPage.tsx` | Back link says "Back to Job" but links to `/jobs/${jobId}`, which re-opens the Candidates tab by default. After viewing a report, HR likely wants the Interviews tab. Should deep-link to `?tab=Interviews`. | Minor navigation friction. |
| P3-6 | `InterviewCompletePage.tsx` | No hiring team contact info shown after interview. Pixel prototype had a contact section. Candidate has no path to ask questions or follow up. | Minor candidate experience gap. |
| P3-7 | `JobsPage.tsx` | Jobs list has no "Closed" / "Paused" filter toggle. All jobs render in one list — active alongside archived. | Minor — worsens as job history grows. |
| P3-8 | `CandidatesTab` | Upload zone accepts `.doc` extension in the file system helper `_is_allowed_file` (`ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}`) but the frontend `accept=".pdf,.docx"` hides `.doc`. Old `.doc` files will fail silently if dragged in (MIME type check will reject them as `application/msword`). | Minor inconsistency between frontend filter and backend validation. |

---

## Candidate App — Issues Found

### P0 — Blocker

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| C-P0-1 | `InterviewLandingPage.tsx` | **Disconnected candidate has no reconnect path.** When `info.status === 'in_progress'`, the page renders the "Interview Already Completed" screen. A candidate who lost WiFi mid-interview cannot see a "Rejoin Interview" option. They're locked out with false messaging. | Permanent loss of interview for any candidate with network instability — common on mobile or bad connections. |

### P1 — High

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| C-P1-1 | `InterviewLandingPage.tsx` | **`expired` session status not handled.** Frontend type omits `expired`. The `if (info.status !== 'pending')` catch-all shows "Already Completed" for expired sessions. Backend may expire sessions via cron in future and this will silently mismatch. | Wrong copy for expired candidates; no clear call-to-action (contact HR). |
| C-P1-2 | `InterviewRoomPage.tsx` | **Page navigation guard missing.** After entering the room, pressing browser Back or accidentally navigating away does NOT warn the candidate. The interview room tears down silently, and the session status moves to `in_progress` — triggering the reconnect block on return. | Inadvertent navigation ends the interview with no warning, same broken loop as C-P0-1. |
| C-P1-3 | `InterviewRoomPage.tsx` | **No maximum interview duration.** The timer shows elapsed time but there is no upper bound. The LiveKit room (and billing) stays open indefinitely if the candidate leaves without clicking End Interview. | Runaway billing. LiveKit room persists and records indefinitely. |
| C-P1-4 | `InterviewRoomPage.tsx` | **409 on `start` is misleading.** Error shows "Interview already started. Please refresh." — but refreshing calls `start` again (via the `useEffect`), which returns another 409. The candidate is stuck in a loop. | Candidate cannot recover without HR intervention. |

### P2 — Medium

| # | Location | Issue | Impact |
|---|----------|-------|--------|
| C-P2-1 | All candidate pages | **Not tested / not designed for mobile.** Side-by-side layout (`flex gap-6`) in InterviewRoomPage places AI and candidate panels next to each other. On a 375px screen (iPhone SE), each panel is ~170px wide — unusable. Candidate app has no responsive breakpoint adjustments for the room. | Majority of Indian candidates interview from mobile. Experience is broken on the most common device type. |
| C-P2-2 | `InterviewCompletePage.tsx` | **No contact information shown.** Original Pixel prototype included hiring team contact. Production complete page has no contact details. Candidate is left with "the hiring team will be in touch" and no way to follow up. | Candidate experience feels incomplete; creates support burden. |
| C-P2-3 | `InterviewRoomPage.tsx` | **Camera permissions requested again inside room** even though they were already granted on the landing page. `LiveKitRoom` with `video={true}` triggers a second permission prompt because the earlier `getUserMedia` stream was stopped (`stream.getTracks().forEach(t => t.stop())`). | Double browser permission dialogs confuse non-technical users. |

---

## Backend — Missing / Broken

| # | Route | Issue | Blocked UI Feature |
|---|-------|-------|--------------------|
| B-1 | `GET /api/jobs/{job_id}/interviews` | Endpoint documented in INTERFACE.md and mentioned in CONTEXT.md Sprint 6 but **not implemented in `interviews.py`**. | InterviewsTab cannot list existing sessions after page refresh (P0-3). |
| B-2 | `PATCH /api/candidates/{id}` | Endpoint does not exist. No way to update phone, name, or any candidate field. | Can't fix no-phone candidates (P0-1). |
| B-3 | `POST /api/jobs/{job_id}/candidates/{id}/retry-parse` | No retry endpoint for `parse_failed` candidates. | Parse-failed candidates permanently stuck (P0-2). |
| B-4 | `DELETE /api/candidates/{id}` | No deletion endpoint. | HR cannot remove mistakenly uploaded or duplicate candidates. |
| B-5 | `interviews.py` L~60 | `interview_url = f"http://localhost:5174/interview/{unique_token}"` — should read from `settings.CANDIDATE_APP_URL` env var. | P0-4: Broken interview links in all non-local environments. |
| B-6 | Score scale mismatch | INTERFACE.md documents interview scores as `0–10`. `ReportPage` renders them as `X/100` with a progress bar that uses score directly as a CSS percentage. If backend actually returns 0–10, all bars show near-0. Need to confirm GPT prompt scale and align frontend. | P1-2: Unreadable report scores. |
| B-7 | Session expiry | No background task to expire old `pending` sessions. Sessions stay open indefinitely. | C-P1-1, P2-6. |
| B-8 | File size limit | No `max_size` guard in `upload_resumes()`. | P2-7: Memory DoS via large file. |
| B-9 | Duplicate email check | No uniqueness constraint or pre-check on `(job_id, email)` during upload. | P2-5: Duplicate candidates. |

---

## Implementation Plan

### Sprint A — Do Now (P0 + Critical P1): ~8–10 dev days

| # | Task | Owner | Est. Effort |
|---|------|-------|-------------|
| A-1 | Add `PATCH /api/candidates/{id}` endpoint (phone, name fields) + HR UI: inline edit button on candidate detail modal to add/edit phone | Forge + Nova | 1.5 days |
| A-2 | Add `POST /api/jobs/{job_id}/candidates/{id}/retry-parse` endpoint + "Retry" button on `parse_failed` cards in CandidatesTab | Forge + Nova | 0.5 days |
| A-3 | Fix interview URL: replace hardcoded `localhost:5174` with `settings.CANDIDATE_APP_URL` env var; add to `.env` and `config.py` | Forge | 0.5 days |
| A-4 | Implement `GET /api/jobs/{job_id}/interviews` endpoint returning all InterviewSessions for a job | Forge | 0.5 days |
| A-5 | InterviewsTab: fetch existing sessions on mount via new endpoint; show URL + status for already-sent candidates instead of only local state | Nova | 1 day |
| A-6 | Candidate App — InterviewLandingPage: add `in_progress` branch that shows a "Rejoin Interview" CTA (navigate to `/room`); add `expired` to the status type and add a purpose-built expiry screen | Nova | 0.5 days |
| A-7 | Candidate App — InterviewRoomPage: add `beforeunload` warning when interview is `in_progress`; fix the 409 reconnect loop by detecting 409 and routing to `/room` directly (skip `start`) | Nova | 0.5 days |
| A-8 | Fix score scale: confirm GPT prompt returns 0–100 or 0–10; align `ScoreCard` label (`/10` or `/100`) and `ScoreBar` percentage multiplier accordingly | Forge + Nova | 0.5 days |
| A-9 | Add confirmation dialog before "Start AI Screening" (number of candidates + cost warning) | Nova | 0.25 days |
| A-10 | ShortlistTab: persist shortlisting in-progress state in TanStack Query cache or localStorage so refresh doesn't lose spinner; alternatively, add a `job.shortlist_status` field from backend | Forge + Nova | 0.5 days |
| A-11 | Add search input and `parse_status` filter dropdown to CandidatesTab | Nova | 0.5 days |
| A-12 | Add bulk "Approve All Shortlisted" + "Reject All Rejected" buttons to ShortlistTab header | Nova | 0.5 days |
| A-13 | Add interview session expiry: background Celery beat task to mark sessions `expired` after X days; add `expired` status to all relevant types | Forge | 0.5 days |
| A-14 | Add job status management: "Close Job" / "Pause Job" dropdown on job header card; PATCH endpoint is already available | Nova | 0.5 days |

---

### Sprint B — Next (P2): ~3–4 dev days

| # | Task | Owner | Est. Effort |
|---|------|-------|-------------|
| B-1 | Surface skipped candidates (no phone) after trigger in ScreeningTab; add per-candidate "Edit Phone" inline action | Nova + Forge | 0.5 days |
| B-2 | Add "Relevant Experience" field to ScreeningResultCard structured grid | Nova | 0.25 days |
| B-3 | Add error banner to DashboardPage (currently silently shows empty state on API failure) | Nova | 0.25 days |
| B-4 | Deduplicate resume uploads: check for matching email in `(job_id, email)` before creating candidate; skip if exists, return existing record | Forge | 0.5 days |
| B-5 | Add 20 MB file size limit guard to `upload_resumes()` | Forge | 0.25 days |
| B-6 | "Show all" toggle for strengths/gaps in ShortlistCard (currently max 3 shown) | Nova | 0.25 days |
| B-7 | Add concurrency lock (Redis-based or DB flag) to prevent double-trigger of shortlisting for same job | Forge | 0.5 days |
| B-8 | Edit job modal (title, description, skills, experience range) — "Edit" button on job header card | Nova | 0.5 days |
| B-9 | Add DELETE `/api/candidates/{id}` endpoint + "Remove" button on candidate cards (with confirmation) | Forge + Nova | 0.5 days |
| B-10 | Candidate App: mobile-responsive layout for InterviewRoomPage (stack vertically on small screens) | Nova | 0.5 days |
| B-11 | Add hiring team contact info to InterviewCompletePage | Nova | 0.25 days |
| B-12 | Add `refetchInterval` back-off in CandidatesTab (8s for first 2 min, then 30s) | Nova | 0.25 days |

---

### Backlog (P3 — Nice to Have)

| # | Task | Owner | Est. Effort |
|---|------|-------|-------------|
| BP-1 | Deep-link back from ReportPage to Interviews tab: `?tab=Interviews` query param in back link | Nova | 0.25 days |
| BP-2 | Status filter toggle on JobsPage (active/closed/paused) | Nova | 0.25 days |
| BP-3 | Fix `.doc` MIME type inconsistency: either add `application/msword` to backend allowed types and frontend `accept`, or remove `.doc` from backend set | Forge + Nova | 0.25 days |
| BP-4 | Replace "P" avatar initial for parsing candidates with a spinner icon | Nova | 0.25 days |
| BP-5 | Reduce chatty `reportChecks` queries in InterviewsTab: batch into single endpoint or reduce interval to 60s | Nova | 0.5 days |
| BP-6 | Truncate long job descriptions in job header card with "Show full description" expand toggle | Nova | 0.25 days |
| BP-7 | Resolve double camera permission prompt on InterviewRoomPage (don't stop tracks on landing page; pass stream to room instead) | Nova | 0.5 days |
| BP-8 | Add per-job "Completed Interviews" metric to Dashboard KPI row | Nova | 0.5 days |
| BP-9 | Pagination or virtual scroll for CandidatesTab when count > 50 | Nova | 1 day |

---

## Priority Summary Table

| Priority | Count | Must-Fix Before |
|----------|-------|----------------|
| P0 | 5 issues | Any live demo or real candidate invite |
| P1 | 10 issues | Any user testing session with real HR users |
| P2 | 10 issues | Beta / wider rollout |
| P3 | 9 issues | GA / polish sprint |

**Recommended sequencing:** Ship Sprint A before any Webknot demo to a real client. Sprint B before handing over to a paying customer. Backlog is optional quality-of-life work.

---

*Auditor: Hermes 🧭 — 2026-06-23*
