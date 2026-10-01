# CONTEXT.md - AI Recruitment Screening & Interview POC
**Last Updated:** 2026-06-23 | Agent: Forge | Session: Smart call outcomes — ended_reason + retry_count + call_outcome on ScreeningCall; classify_call_outcome(); auto-retry (no_answer/voicemail/dropped, max 3, 30m/2h/24h); skip GPT on no-transcript outcomes; migration e7a3d1f2b6c8

**Previous:** 2026-06-23 | Agent: Forge | Session: Sprint B — duplicate upload guard (B-4), 20MB file size limit (B-5), Redis shortlist lock (B-7), DELETE /api/candidates/{id} (B-9)

---

## What's Been Built

### Sprint 1 - Pixel (2026-06-19)

#### HR App (`projects/ai-recruitment-poc/prototype/hr-app/`)
Complete React + TypeScript + Vite + Tailwind CSS prototype. All source files written.

**Screens:**
1. **Dashboard** (`src/pages/Dashboard.tsx`) - Pipeline metrics (6 KPI cards), pipeline stage visualiser, active jobs quick links, activity feed
2. **Jobs List** (`src/pages/JobsList.tsx`) - Table with status badges, search, "Create New Job" button
3. **Create Job Modal** (`src/components/CreateJobForm.tsx`) - Full form: title, description, skill chips, experience range, screening criteria, interview criteria
4. **Job Detail** (`src/pages/JobDetail.tsx`) - 4-tab interface:
   - Candidates tab: drag-drop upload area, Google Drive URL input, candidate card grid with parse status badges, click-to-detail
   - Shortlist tab: AI shortlist trigger button, candidate cards with score badges, strengths/gaps, HR decision actions, feedback modal
   - Screening tab: phone validation warning banner, Start AI Screening button, result cards with structured fields (CTC, notice, availability), Pass/Fail/Needs Review badges, Send Interview Link button
   - Interviews tab: interview session list with status badges, View Report links
5. **Candidate Detail Modal** (`src/components/CandidateDetailModal.tsx`) - Full parsed profile: skills chips, experience timeline, education, projects
6. **Interview Report** (`src/pages/InterviewReport.tsx`) - Overall score dial (circular), 5 score bars, JD fit paragraph, strengths chips, weaknesses chips, collapsible transcript summary

**Design System:**
- `tailwind.config.ts` - full token set: brand colors, sidebar, status, score, shadows, spacing
- `src/components/ui/` - Badge variants, Button, Card, Modal, Tabs, ScoreBar/OverallScore, EmptyState

#### Candidate App (`projects/ai-recruitment-poc/prototype/candidate-app/`)
Separate Vite + React app. All source files written.

**Screens:**
1. **Interview Landing** (`src/pages/InterviewLanding.tsx`) - 4 states: valid/pending (main CTA page), invalid token (404-style), already completed, expired
2. **Interview Room** (`src/pages/InterviewRoom.tsx`) - Dark UI, AI avatar with pulse ring animation, waveform visualizer, candidate panel, mic toggle, End Interview with confirmation modal, timer
3. **Interview Complete** (`src/pages/InterviewComplete.tsx`) - Success illustration, warm thank-you message, numbered next-steps, contact info

#### Documentation
- `prototype/DESIGN-NOTES.md` - Full design decisions, component library, stub data notes, handoff guide for Nova

### Sprint 2 - Nova (2026-06-19)

#### HR App (`projects/ai-recruitment-poc/hr-app/`)
Production-ready React 18 + TypeScript + Vite scaffold. No stub data - real API client wired.

**Files:**
- Full Vite + TypeScript project config (vite.config.ts, tsconfig.json, tsconfig.app.json, tsconfig.node.json)
- Tailwind CSS with Pixel's exact design tokens (indigo primary, slate sidebar, emerald/rose/amber states)
- shadcn/ui dependencies in package.json (Radix UI primitives + class-variance-authority)
- `src/lib/utils.ts` - cn() helper (clsx + tailwind-merge)
- `src/lib/api.ts` - Axios instance + QueryClient (retry:1, staleTime:30s)
- `src/main.tsx` - QueryClientProvider + BrowserRouter + ReactQueryDevtools in dev
- `src/App.tsx` - Routes: /, /jobs, /jobs/:id, /report/:id all via Layout
- `src/components/Layout.tsx` - slate-900 sidebar, indigo-600 active nav, mobile hamburger, page title top bar
- Placeholder pages: DashboardPage, JobsPage, JobDetailPage, ReportPage

#### Candidate App (`projects/ai-recruitment-poc/candidate-app/`)
Same stack + LiveKit deps in package.json (not yet installed - Sprint 6).

**Files:**
- Full Vite + TypeScript project config
- Tailwind CSS with slate-950 dark theme tokens
- `@livekit/components-react` + `livekit-client` in package.json dependencies
- `src/lib/utils.ts`, `src/lib/api.ts` - identical shared logic
- `src/main.tsx` - QueryClientProvider + BrowserRouter
- `src/App.tsx` - Routes: /interview/:token, /interview/:token/room, /interview/:token/complete; catch-all → /interview/demo
- `src/components/Layout.tsx` - minimal dark full-screen layout, subtle header
- Placeholder pages: InterviewLandingPage, InterviewRoomPage, InterviewCompletePage

---

## Installation Status

✅ **Both apps installed and verified running.**

| App | Status | URL |
|-----|--------|-----|
| HR App | ✅ Running, zero errors | http://localhost:5177/ (or next available port) |
| Candidate App | ✅ Running, zero errors | http://localhost:5178/ (or next available port) |

To run locally:
```powershell
# HR App
cd projects/ai-recruitment-poc/prototype/hr-app ; npm run dev

# Candidate App (separate terminal)
cd projects/ai-recruitment-poc/prototype/candidate-app ; npm run dev
```

Candidate App demo routes:
- `http://localhost:<port>/interview/demo-token-arjun` - active interview landing
- `http://localhost:<port>/interview/demo-token-sneha` - already completed state
- `http://localhost:<port>/interview/demo-token-expired` - expired state
- `http://localhost:<port>/interview/anything-else` - invalid token state

---

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Two separate Vite apps (not monorepo) | Cleaner for POC; matches production plan from SPEC.md |
| Dark sidebar in HR app | Professional enterprise feel; Notion/Linear inspired |
| Dark background for candidate interview UI | High-stakes context; focused environment |
| No Radix UI `Dialog` / `Tabs` - custom implementations | Avoids Radix version conflicts in prototype; simpler setup |
| Score colour thresholds: 80+ green, 60-79 amber, <60 red | Mirrors standard hiring rubrics |
| Candidate app has demo token redirect at `/` | Developer convenience for prototype review |
| Demo tokens: `demo-token-arjun` (active), `demo-token-sneha` (completed), `demo-token-expired` | All three states are immediately accessible |

---

## Gotchas & Landmines

1. **Path alias** - Using `fileURLToPath(new URL('./src', import.meta.url))` instead of `path.resolve(__dirname)` in vite.config.ts because vite config uses ESM (`"type": "module"` in package.json)
2. **`tail` is not available in PowerShell** - Use `Select-Object -Last N` instead
3. **Both apps use port** - hr-app: 5173, candidate-app: 5174. Don't run on same port.
4. **Radix UI packages included in hr-app** but tabs/modal are custom - some Radix packages are in package.json but not yet used. This is fine; Nova can use them in Sprint 2.
5. **`noUnusedLocals: false`** in tsconfig - disabled to avoid TS errors on stub code; enable before Sprint 2 production code.
6. **`react-hot-toast` added to package.json** in Sprint 3 - `npm install` must be run in `hr-app/` before the app boots.
7. **FormData upload fix** - The Axios request interceptor was overriding Content-Type to `application/json` even for FormData bodies. Fixed in Sprint 3: interceptor now skips FormData. If file uploads silently fail, check api.ts interceptor.
8. **Backend 501 stubs resolved** - Sprint 3 Forge task completed all backend routes. Jobs CRUD, resume upload, Google Drive import, candidate list, and candidate detail are all real implementations. No more 501s on these routes.
9. **`parse_status` is the correct DB/ORM field name** - CONTEXT.md previously had this backwards. The DB column, ORM model, Pydantic schema, and all Celery tasks all use `parse_status`. Fixed on 2026-06-22 by Goku during live debugging session.
11. **Shortlisting is async — GET /api/jobs/{job_id}/shortlist returns `[]` while running** — Nova must treat empty array as "in progress" state (not error) when shortlisting has been triggered. Poll until records appear.
12. **ShortlistResult upsert preserves hr_decision** — re-triggering shortlisting will update AI scores but NOT reset hr_decision or hr_feedback. This is intentional — HR work is preserved across re-runs.
13. **cosine_similarity uses pure-Python (no numpy)** — fine for POC (1536-dim vectors, <100 candidates per job). If scale increases, switch to `numpy.dot` for performance.

14. **Vapi webhook URL is `/api/screening/webhook`** (not `/api/vapi/webhook`) — Sprint 5 rewrite changed the stub path. Update Vapi dashboard webhook URL accordingly.
15. **Old stub endpoints removed** — `POST /api/jobs/{job_id}/screening/start` and `GET /api/candidates/{id}/screening` no longer exist. Replaced by: `POST /api/jobs/{job_id}/screening/trigger` and `GET /api/jobs/{job_id}/screening`.
16. **ScreeningCall lookup in webhook uses `vapi_call_id`** — if Vapi sends a webhook before `initiate_screening_call` Celery task completes (race condition), the call may not be found. This is unlikely (Vapi calls only end after they start) but worth noting.

17. **`ReportPage.tsx` polls every 10s until report ready** — uses `refetchInterval: 10_000` while `report` is null/error. TanStack Query fires `refetchInterval` even when in error state, so 404s will keep retrying until the assessment completes. The `isReportNotReady` variable (not `is404`) controls the friendly pending UI.
18. **`Job.required_skills` is nullable from backend** — `Optional[List[str]] = None` in Pydantic schema. Frontend type is now `string[] | null`. Always guard with `?.length ?? 0` before accessing.
19. **`_build_needs_review_report()` returns None scores** — fallback report for too-short transcripts uses `None` for all score fields (not `0`). Frontend `ScoreCard` renders `"—"` for null, `"0/100"` for 0 — distinction matters for UX.

20. **`POST /api/jobs/{job_id}/resumes` response shape changed in Sprint B** — no longer returns `CandidateResponse[]`. Now returns `ResumeUploadResponse` with `{ created, skipped, skipped_files, candidate_ids }`. Nova must update `CandidatesTab` upload handler accordingly.
21. **Redis lock on shortlisting** — `POST /api/jobs/{job_id}/shortlist` returns `409` if a task is already in progress. Lock is set on trigger (NX=true, EX=300) and released in Celery `finally`. Nova should show an "already in progress" banner on 409.
22. **`original_filename` column requires migration d4f1a2b3c5e6** — run `alembic upgrade head` after deploying Sprint B. Dedup check silently breaks without it.

10. **Google Drive uses service account JSON, not API key** - Set `GOOGLE_DRIVE_CREDENTIALS_JSON` with the full service account JSON string. The API key approach was removed. Without this env var, the endpoint returns `503` gracefully.

---

## Sprint Gate Status

| Gate | Status |
|------|--------|
| All HR screens built | ✅ Done |
| All Candidate screens built | ✅ Done |
| Design system defined | ✅ Done |
| `npm run dev` both apps | ✅ Verified - both boot clean, zero errors |
| Pranav design review | ⏳ Pending - ready for Pranav to open in browser |
| HR App production scaffold (2.9) | ✅ Done |
| Jobs list page (3.10) | ✅ Done |
| Job detail page (3.11) | ✅ Done |
| Resume upload UI (3.12) | ✅ Done |
| Candidates list + polling (3.13) | ✅ Done |
| Candidate detail modal (3.14) | ✅ Done |
| Candidate App production scaffold (2.10) | ✅ Done |
| HR App Layout shell (2.11) | ✅ Done |
| Candidate App Layout shell (2.12) | ✅ Done |
| Shared API client + main.tsx (2.13) | ✅ Done |
| `npm install` both apps | ⏳ Pending - Goku to run |
| GPT-4o resume parser (3.5) | ✅ Done |
| Embeddings service (3.6) | ✅ Done |
| Celery task chain parse+embed (3.7) | ✅ Done |
| Job CRUD API with status filter (3.1) | ✅ Done |
| Resume Upload endpoint (3.2) | ✅ Done |
| Celery extract_resume_text task (3.3) | ✅ Done |
| Google Drive import + 503 fallback (3.4) | ✅ Done |
| Candidate List endpoint (3.8) | ✅ Done |
| Candidate Detail endpoint (3.9) | ✅ Done |
| INTERFACE.md written for Nova | ✅ Done |
| Shortlisting trigger endpoint (4.1) | ✅ Done |
| Shortlist results endpoint (4.2) | ✅ Done |
| HR decision endpoint (4.3) | ✅ Done |
| HR feedback endpoint (4.4) | ✅ Done |
| Cosine similarity scoring service (4.5) | ✅ Done |
| GPT-4o shortlist prompt (4.6) | ✅ Done |
| Celery batch shortlisting task (4.7) | ✅ Done |
| INTERFACE.md updated for Sprint 4 | ✅ Done |
| Screening trigger endpoint (5.1) | ✅ Done |
| Vapi webhook endpoint (5.2) | ✅ Done |
| Screening results endpoint (5.3) | ✅ Done |
| Phone validation service (5.4) | ✅ Done |
| Vapi.ai outbound call service (5.5) | ✅ Done |
| Celery screening tasks (5.6) | ✅ Done |
| GPT-4o pass/fail classifier (5.7) | ✅ Done |
| INTERFACE.md updated for Sprint 5 | ✅ Done |
| ScreeningTab — screening management page (5.8) | ✅ Done |
| Phone number validation UI (5.9) | ✅ Done |
| Screening result card — structured fields (5.10) | ✅ Done |
| Screening status polling every 8s (5.11) | ✅ Done |
| Run AI Shortlist button in CandidatesTab (4.8) | ✅ Done |
| ShortlistTab — shortlist review page (4.9) | ✅ Done |
| Approve/Reject/Override UI with optimistic update (4.10) | ✅ Done |
| Feedback inline form per shortlist card (4.11) | ✅ Done |
| docker-compose.yml (2.1) | ✅ Done |
| FastAPI scaffold (2.2) | ✅ Done |
| Core config + database (2.3) | ✅ Done |
| ORM models - all 6 (2.4) | ✅ Done |
| Alembic setup + migration (2.5) | ✅ Done |
| Celery + Redis worker (2.6) | ✅ Done |
| Pydantic schemas (2.7) | ✅ Done |
| Health check + CORS + error handler (2.8) | ✅ Done |

---

## Open Questions

- [x] Mode A confirmed - no external designs
- [x] Should "Run AI Shortlist" show a progress indicator polling state? — YES: ShortlistTab polls every 3s when shortlistTriggered=true and results=[]; shows spinner state. Resolved in Sprint 4 Nova.
- [ ] Any specific Webknot brand colors to use instead of Indigo? Current choice is clean but generic.
- [ ] Forge: `alembic upgrade head` must be validated once docker-compose is running - migration script is written but not yet tested against a live DB (no exec access during Sprint 2 subagent).
- [ ] **Warden MUST check:** Sage's original resume_tasks.py referenced `candidate.parse_status` (wrong field name - model uses `parsing_status`). Forge rewrote and fixed the entire file in Sprint 3. Confirm no other files still reference `parse_status`.
- [ ] Nova: Consider stripping `resume_raw_text` from candidate LIST endpoint response - large field, only needed in detail view.

### Sprint 5 — Forge (2026-06-22)

#### AI Voice Screening Backend (`projects/ai-recruitment-poc/backend/`)

**`app/services/phone_validation.py`** (Task 5.4)
- `validate_phone(phone: str) -> tuple[bool, str]` — validates and normalises to E.164
- Strips +, spaces, dashes, parens before checking digit count
- Indian 10-digit → prepends +91; 12-digit starting with 91 → adds + prefix
- Other 10+ digit numbers → adds + prefix; returns (False, "") if <10 digits

**`app/services/vapi_service.py`** (Task 5.5)
- `async def initiate_screening_call(candidate, job, screening_call_id) -> str`
- POSTs to `https://api.vapi.ai/call` with Bearer token from settings
- Builds screening prompt: availability, employment status, experience, current/expected CTC, notice period, location, willingness
- Voice: sarvam/anushka; Transcriber: deepgram nova-2 EN; Model: gpt-4o
- firstMessage personalised with candidate name + job title
- Metadata includes screening_call_id for webhook correlation
- Raises Exception with status code + body on HTTP error

**`app/tasks/screening_tasks.py`** (Tasks 5.6, 5.7)
- `tasks.initiate_screening_call(screening_call_id)` — loads ScreeningCall+Candidate+Job, calls vapi_service, updates call_status=initiated or failed on Vapi error
- `tasks.process_screening_webhook(payload)` — extracts transcript from Vapi payload, saves transcript first (before GPT attempt), calls GPT-4o with structured extraction prompt
- GPT-4o extracts: availability, employment_status, relevant_experience, current_ctc, expected_ctc, notice_period, location_preference, communication_quality, willingness_to_proceed, summary, result
- Result classifier: pass=strong fit signals, fail=clear disqualifiers, needs_review=ambiguous (conservative bias)
- Both tasks use `get_celery_db()` NullPool pattern
- Retry logic: AuthenticationError=no retry, RateLimitError=300s, APIConnectionError=120s

**`app/api/routes/screening.py`** (Tasks 5.1, 5.2, 5.3 — full rewrite)
- `POST /api/jobs/{job_id}/screening/trigger` — validates job, checks each candidate_id for hr_decision=approved, validates phone (422 if missing), creates ScreeningCall record per candidate, enqueues Celery task
- `POST /api/screening/webhook` — no auth, finds ScreeningCall by vapi_call_id, enqueues process_screening_webhook, returns 200 immediately
- `GET /api/jobs/{job_id}/screening` — returns ScreeningCallResponse[], ordered by created_at desc

**`app/core/config.py`**
- Added `VAPI_PHONE_NUMBER_ID: str = ""` (SARVAM_API_KEY was already present from Sprint 2)

---

### Sprint 3 - Sage (2026-06-20)

#### AI Services

**Resume Parser** (`backend/app/services/resume_parser.py`)
- `parse_resume(raw_text: str) -> dict` - calls GPT-4o with `response_format={"type": "json_object"}`
- System prompt extracts: name, email, phone, skills, total_experience_years, experience[], education[], current_company, current_role
- Truncates input to 8000 chars to stay within context limits
- Temperature 0, max_tokens 2000 for deterministic structured output

**Embedding Service** (`backend/app/services/embedding_service.py`)
- `generate_embedding(text: str) -> list[float]` - calls `text-embedding-3-small` (1536 dims)
- Truncates input to 6000 chars (well within 8191 token limit)
- Returns raw float vector for pgvector storage

**Celery Task Chain** (`backend/app/tasks/resume_tasks.py`)
- `tasks.extract_resume_text` - stub preserved from Forge, awaiting Sprint 3 Forge implementation
- `tasks.parse_resume` - sync Celery task, uses `asyncio.run(_async_parse())`, max_retries=3, countdown=120
  - Reads candidate from DB, calls resume_parser service, sets `parse_status="parsed"`, back-fills name/email/phone if missing, chains to embedding task
- `tasks.generate_candidate_embedding` - sync Celery task, uses `asyncio.run(_async_embed())`, max_retries=3, countdown=120
  - Reads candidate from DB, calls embedding_service, stores vector in `resume_embedding`, sets `parse_status="ready"`
- Both tasks set `parse_status="parse_failed"` on any exception before raising for Celery retry

### Sprint 3 — Forge (2026-06-20)

#### Backend APIs + Celery Tasks (`projects/ai-recruitment-poc/backend/`)

**`app/api/routes/jobs.py`** (Task 3.1)
- `GET /api/jobs` now supports optional `?status=` query param filter
- `POST`, `GET /{id}`, `PATCH /{id}` were already real (Sprint 2 foundation) — confirmed working

**`app/api/routes/candidates.py`** (Tasks 3.2, 3.4, 3.8, 3.9 — full rewrite)
- `POST /api/jobs/{job_id}/resumes` — PDF/DOCX file upload, validates type (422 on wrong type), handles mkdir failure (500), creates Candidate records with `parsing_status=pending_parse`, enqueues `extract_resume_text` per candidate
- `POST /api/jobs/{job_id}/resumes/drive` — Google Drive import. Returns 503 gracefully if `GOOGLE_DRIVE_CREDENTIALS_JSON` not set. Uses service account credentials. Handles invalid URLs (400), Drive API errors (502)
- `GET /api/jobs/{job_id}/candidates` — list candidates, 404 if job not found
- `GET /api/candidates/{candidate_id}` — full candidate detail, 404 if not found

**`app/tasks/resume_tasks.py`** (Task 3.3 + Sage fix)
- `extract_resume_text` task: PyMuPDF for PDF, python-docx for DOCX, file-not-exist → parse_failed (no retry), other failures → retry with countdown=60, chains to `parse_resume` on success
- Fixed critical bug: Sage's `parse_resume` / `generate_candidate_embedding` used `candidate.parse_status` (wrong field). Fixed to `candidate.parsing_status` throughout.
- All fallbacks implemented: file not found (no retry), candidate not found (log + return early), OpenAI auth error (no retry), rate limit (retry 300s), connection error (retry 120s)

**`app/core/config.py`**
- Added `GOOGLE_DRIVE_CREDENTIALS_JSON: str = ""` setting

**`INTERFACE.md`**
- Full API contract for Nova: all endpoints, request/response shapes, parsing_status values, Nova-specific gotchas

### Sprint 4 — Forge (2026-06-22)

#### AI Shortlisting & HR Review APIs (`projects/ai-recruitment-poc/backend/`)

**`app/services/shortlist_service.py`** (Tasks 4.5 + 4.6)
- `async def shortlist_candidates(job_id, db)` — main entry point
- Builds JD embedding from title + description + required_skills + screening/interview criteria
- Pure-Python cosine similarity between JD embedding and each candidate's `resume_embedding`
- GPT-4o call per candidate: expert recruiter system prompt, JSON output (match_score 0-100, recommendation shortlisted/rejected/review, strengths[], gaps[], reason)
- `response_format={"type": "json_object"}`, temperature=0, max_tokens=1000
- GPT-4o failure fallback: cosine-only score with reason string (HR can re-trigger)
- Upsert pattern: re-scoring preserves existing hr_decision/hr_feedback
- Returns list of upserted ShortlistResult records

**`app/tasks/shortlist_tasks.py`** (Task 4.7)
- `tasks.run_shortlist(job_id: str)` — Celery task
- Same pattern as `resume_tasks.py`: sync wrapper → asyncio.run() → async inner function
- `get_celery_db()` NullPool (critical on Windows event loop)
- Error handling: AuthenticationError=no retry, RateLimitError=300s, APIConnectionError=120s, ValueError (job not found)=no retry, other=retry 120s

**`app/api/routes/shortlist.py`** (Tasks 4.1–4.4)
- `POST /api/jobs/{job_id}/shortlist` — validates job exists + at least one ready candidate (422 if none), enqueues `tasks.run_shortlist`, returns `{ status: "shortlisting_started", job_id }`
- `GET /api/jobs/{job_id}/shortlist` — returns `ShortlistResultWithCandidateResponse[]`, batch-loads candidates to avoid N+1, ordered by match_score desc
- `PATCH /api/shortlist/{id}/decision` — validates hr_decision enum (approved/rejected/overridden)
- `POST /api/shortlist/{id}/feedback` — updates hr_feedback_type + hr_comments

**`app/schemas/schemas.py`**
- Added `ShortlistResultWithCandidateResponse` extending `ShortlistResultResponse` with `candidate_name: Optional[str]` and `candidate_email: Optional[str]`

**`INTERFACE.md`**
- All 4 Sprint 4 endpoints documented with request/response shapes, error codes, and Nova-specific gotchas

### Sprint 3 — Nova (2026-06-20)

#### HR App Frontend - Jobs & Resume Pipeline (`projects/ai-recruitment-poc/hr-app/`)

All Sprint 3 frontend tasks complete. Real API calls wired to backend.

**New Files Created:**
- `src/types/api.ts` - TypeScript interfaces: `Job`, `Candidate`, `ParsedData` - single source of truth for all API shapes
- `src/pages/JobsPage.tsx` - Full Jobs list page (replaced placeholder):
  - TanStack Query: `useQuery(['jobs'])` with 30s refetchInterval
  - Table with Title + skills preview, Status badge, Candidates count, Created date, View link
  - Status badge colors: open=indigo-100/700, closed=slate-100/600, paused=amber-100/700
  - Loading: 3-row animate-pulse skeleton
  - Empty state: icon + copy + "Create Job" CTA button
  - Error state: rose banner + retry button
- `src/components/CreateJobModal.tsx` - Full job creation modal:
  - Fields: title*, description*, required skills (tag chip input), min/max experience years, screening criteria, interview evaluation criteria
  - Skill tag input: Enter/comma adds chip, Backspace removes last chip, X button removes individual chips
  - `useMutation` → `POST /api/jobs`; invalidates `['jobs']` queryKey on success
  - Toast: success "Job created successfully" / error "Failed to create job"
- `src/pages/JobDetailPage.tsx` - Full Job detail page (replaced placeholder):
  - `useQuery(['job', jobId])` - 404 detection via error message matching
  - Header card: title, status badge, description, required skills chips (indigo-50/700 border), experience range
  - 4 tabs: Candidates (live) | Shortlist (Sprint 4 stub) | Screening (Sprint 5 stub) | Interviews (Sprint 6 stub)
  - Loading skeleton, 404 state with back link, generic error state
- `src/components/CandidatesTab.tsx` - Drag-and-drop upload + candidates grid:
  - Upload zone: dashed border, drag-over highlight (indigo-50/border-indigo-400), click-to-browse
  - Hidden file input: multiple, accept .pdf/.docx, validates file types
  - Upload mutation: `POST /api/jobs/{jobId}/resumes` with FormData
  - Google Drive import: `POST /api/jobs/{jobId}/resumes/drive` with `{ drive_url }`
  - Toast on upload success/failure; uploading overlay spinner
  - `useQuery(['candidates', jobId])` with smart polling: refetchInterval=5000 while any candidate is in pending_parse/parsing/embedding_done, false otherwise
  - Card grid: 3-col responsive, parse status badge, click → CandidateDetailModal
  - Loading: 6-card skeleton; empty state: prompt copy
- `src/components/CandidateDetailModal.tsx` - Full candidate parsed profile modal:
  - Non-ready state: status badge + processing message
  - Ready state: contact row (email/phone with icons), current role at company, total experience, skills chips, experience timeline with "Show more" toggle for long descriptions, education
  - Click outside or X to close

**Modified Files:**
- `src/App.tsx` - Added `<Toaster />` from react-hot-toast (top-right, 4s duration)
- `src/lib/api.ts` - Fixed request interceptor: skip Content-Type override for FormData bodies (required for multipart file upload)
- `package.json` - Added `react-hot-toast: ^2.4.1` to dependencies

**Design decisions:**
- Candidate display name: prefers `parsed_data.name` → `candidate.name` → filename without extension → `Candidate #{id}`
- Backend returns 501 for stub endpoints - UI handles gracefully (catches error, shows toast)
- No `any` types anywhere - all typed via `src/types/api.ts`

### Sprint 4 — Nova (2026-06-22)

#### HR App Frontend - AI Shortlisting & HR Review UI (`projects/ai-recruitment-poc/hr-app/`)

**New Files Created:**
- `src/components/ShortlistTab.tsx` - Full shortlist review UI:
  - Loading: 3-card animate-pulse skeleton
  - In-progress state: spinner + "AI is scoring candidates…" (shown while Celery task runs, auto-polls every 3s)
  - Empty state: icon + copy + "Go to Candidates" button (switches tab via callback)
  - Results list: `ShortlistCard` per record, sorted by match_score desc (backend already sorts)
  - **ScoreBadge**: green ≥70%, amber 50-69%, red <50%
  - **RecommendationBadge**: emerald=shortlisted, rose=rejected, amber=review
  - Strengths: green chips, max 3 shown
  - Gaps: red chips, max 3 shown
  - Reason text: truncated at 160 chars with expand/collapse toggle
  - **HR Decision buttons** (Task 4.10): Approve (emerald) / Reject (rose) / Override (amber); active decision highlighted; optimistic update via TanStack Query onMutate/onError/onSettled; calls `PATCH /api/shortlist/{id}/decision`
  - **Feedback inline form** (Task 4.11): "Give Feedback" button per card; feedback_type dropdown (4 options); optional comments textarea; calls `POST /api/shortlist/{id}/feedback`; success message auto-collapses form after 2s

**Modified Files:**
- `src/types/api.ts` - Added `HrDecision`, `HrFeedbackType`, `ShortlistResult`, `ShortlistResultWithCandidate` interfaces
- `src/components/CandidatesTab.tsx` (Task 4.8) - Added `RunShortlistButton` component:
  - Disabled when no candidate has `parse_status === 'ready'`; tooltip explains why
  - On click: `POST /api/jobs/{jobId}/shortlist`
  - Loading state: spinner + "Shortlisting in progress…" text
  - Success: green inline banner (auto-dismisses 5s), invalidates `['shortlist', jobId]`
  - Error: red inline banner
  - Fires `onShortlistTriggered` callback to parent (JobDetailPage)
  - `Props` extended with optional `onShortlistTriggered?: () => void`
- `src/pages/JobDetailPage.tsx` - Replaced Shortlist stub with `ShortlistTab`:
  - Added `shortlistTriggered` state (boolean)
  - Passed `onShortlistTriggered` callback to `CandidatesTab`
  - Wired `ShortlistTab` with `shortlistTriggered`, `onShortlistComplete`, `onSwitchToCandidates` props

**Design decisions:**
- `shortlistTriggered` state lives in `JobDetailPage` (common parent of `CandidatesTab` + `ShortlistTab`) — clean prop flow, no context needed
- ShortlistTab polls every 3s only when `shortlistTriggered=true` AND results are empty — stops immediately when results arrive
- Feedback form is inline (not modal) per task spec — lighter UX, no focus management complexity
- Optimistic update for decisions uses exact TanStack Query pattern (cancel/snapshot/update/rollback)

---

### Sprint 6 — Forge + Nova (2026-06-22)

#### LiveKit Video Interview Platform (`projects/ai-recruitment-poc/backend/` + frontend apps)

**Backend — Forge:**

**`app/services/livekit_service.py`**
- Room creation via LiveKit Server API
- Candidate and HR access token generation (scoped permissions)
- LiveKit Egress room recording enabled (saves to LiveKit Cloud)

**`app/services/email_service.py`**
- Resend API integration for transactional email
- Sends interview link emails to candidates with unique tokens
- `RESEND_API_KEY` added to config + `.env`

**`app/services/assessment_service.py`**
- GPT-4o interview assessment pipeline
- Scores 5 dimensions: communication, technical, problem-solving, cultural fit, overall
- JD fit analysis, strengths, weaknesses extraction
- Triggered by agent after transcript saved (not by `/complete` endpoint — fixes race condition)

**`app/tasks/interview_tasks.py`**
- Celery task: `run_assessment(interview_id)` — loads transcript, calls assessment_service, saves results
- NullPool pattern (same as other tasks)

**`app/api/routes/interviews.py`**
- `POST /api/jobs/{job_id}/interviews/send` — creates Interview record, generates LiveKit room, sends candidate email
- `GET /api/jobs/{job_id}/interviews` — lists all interviews for a job
- `GET /api/interviews/{interview_id}` — interview detail (used by candidate landing page via token)
- `POST /api/interviews/{interview_id}/complete` — marks interview complete, enqueues assessment
- `GET /api/candidates/{candidate_id}/report` — full assessment report

**`backend/interview_agent.py`** — LiveKit AI Interview Agent
- Uses official `AgentServer` + `@server.rtc_session` pattern (livekit-agents v1.6.2)
- `generate_reply()` for greeting (not `session.say()`) — proper interruption handling
- `TurnHandlingOptions` + `preemptive_generation=True` tuned for Indian English
- ai.coustics noise cancellation plugin integrated
- Real-time transcript capture via `conversation_item_added` event
- Assessment triggered by agent after transcript saved (race condition fix)
- Deepgram STT + OpenAI GPT-4o LLM + OpenAI TTS

**`app/models/models.py`**
- `egress_id` field added to Interview model (LiveKit recording reference)

**Candidate App — Nova:**
- `InterviewLandingPage.tsx` — token validation, 4 states: valid (CTA), invalid (404-style), already completed, expired
- `InterviewRoomPage.tsx` — LiveKit video+audio, side-by-side layout (candidate left, AI right), waveform animation, speaking indicators, mic toggle, End Interview with confirmation modal, timer
- `InterviewCompletePage.tsx` — success illustration, warm thank-you, numbered next-steps, contact info

**HR App — Nova:**
- `InterviewsTab.tsx` — interview session list, status badges, Send Interview Link button, View Report links
- `ReportPage.tsx` — overall score dial, 5 dimension score bars, JD fit paragraph, strengths chips, weaknesses chips, collapsible transcript
- `JobDetailPage.tsx` — Interviews tab wired up

**Verified working:**
- Interview link sent → candidate joins room → AI agent conducts interview → transcript captured → GPT-4o assessment generated → HR views report in browser

---

## Update Log

| Date | Agent | Changes |
|------|-------|---------|  
| 2026-06-23 | Forge | Smart call outcomes: ended_reason + retry_count + call_outcome on ScreeningCall model + schema; classify_call_outcome(); auto-retry for no_answer/voicemail/dropped (max 3, delays 30m/2h/24h); skip GPT extraction on no-transcript outcomes; migration e7a3d1f2b6c8; INTERFACE.md + ScreeningCallResponse updated. |
| 2026-06-23 | Nova | Call outcome UI: CallOutcomeBadge component, outcome-specific labels (No Answer/Voicemail/Dropped/etc), auto-retry scheduled indicator, attempt counter. ended_reason/call_outcome/retry_count added to ScreeningCall type. |
| 2026-06-23 | Nova | Sprint B: skipped candidates banner in ScreeningTab (B-1), relevant_experience field (B-2), Dashboard error state (B-3), show-all strengths/gaps toggle (B-6), EditJobModal + pencil button in JobDetailPage (B-8), delete candidate button in CandidatesTab (B-9), mobile-responsive InterviewRoomPage flex-col md:flex-row (B-10), contact info on InterviewCompletePage (B-11), polling back-off after 2min (B-12). SkippedCandidate interface added to api.ts. |
| 2026-06-23 | Forge | Sprint B: duplicate upload guard by filename (B-4), 20MB file size limit (B-5), Redis shortlist lock (B-7), DELETE /api/candidates/{id} (B-9). Added original_filename col + migration d4f1a2b3c5e6. INTERFACE.md updated. |
| 2026-06-23 | Nova | Sprint A: phone edit in CandidateDetailModal (A-1), InterviewsTab sessions from backend (A-5), candidate app rejoin+expired screens (A-6), beforeunload+409 fix (A-7), screening confirmation dialog (A-9), shortlist localStorage persist (A-10), candidate search+filter (A-11), bulk approve/reject (A-12), job status management (A-14) |
| 2026-06-23 | Forge | Sprint A: CANDIDATE_APP_URL env var (A-3) — interview URL no longer hardcoded; GET /api/jobs/{job_id}/interviews implemented with enrichment (A-4); POST retry-parse endpoint (A-2); PATCH /api/candidates/{id} with CandidateUpdate schema (A-1); InterviewSession.expires_at column + migration c9d1e2f3a4b5 + expiry check in get_session_by_token (A-13). INTERFACE.md updated with all 3 new endpoints. |
| 2026-06-23 | Goku | Sprint 7 gate: Warden REVIEW_PASS (after Forge fixed P1-1 port 8080, P1-2/P1-3 ReportPage 404+polling, P1-4 Dashboard null guard, P2-1 InterviewReport types, P2-2 assessment None scores, P3 dead imports) + Goku patched refetchInterval TDZ. Sentinel QA_PASS — 14 files checked, all PASS, 3 non-blocking P3 notes. Gate check OPEN. POC declared complete. |  
| 2026-06-23 | Forge | Warden REVIEW_FAIL fixes: [P1-1] api.ts port 8000→8080 (both apps), [P1-2] ReportPage isReportNotReady check includes 'not ready', [P1-3] ReportPage polling refetchInterval:10s, [P1-4] Dashboard required_skills null guard + Job type, [P2-1] InterviewReport candidate_name/job_title fields + removed extra queries, [P2-2] assessment fallback scores 0→None, [P3] dead imports + ScreeningCall updated_at removed |
| 2026-06-22 | Forge | Sprint 7: GET /api/candidates/:id/report — 404 msg fixed to "Report not ready yet", candidate_name + job_title added via joins (dict-merge pattern), InterviewReportResponse schema updated with all required fields. INTERFACE.md written — 22 endpoints documented with full request/response shapes, TS interfaces, error codes, Nova gotchas. Server on port 8080 runs without --reload; changes take effect on next restart. |
| 2026-06-19 | Pixel | Sprint 1: all source files written, design system, all screens, DESIGN-NOTES.md |
| 2026-06-19 | Nova | Sprint 2 (tasks 2.9-2.13): production app scaffolds created for hr-app/ and candidate-app/ |
| 2026-06-19 | Forge | Sprint 2 (tasks 2.1-2.8): docker-compose.yml, FastAPI scaffold, ORM models, Alembic migrations, Celery setup, Pydantic schemas, health check + CORS + error handler |
| 2026-06-20 | Sage | Sprint 3 (tasks 3.5-3.7): resume_parser.py (GPT-4o), embedding_service.py (text-embedding-3-small), resume_tasks.py (Celery task chain) |
| 2026-06-20 | Nova | Sprint 3 (tasks 3.10-3.14): JobsPage, CreateJobModal, JobDetailPage, CandidatesTab, CandidateDetailModal, api.ts types, react-hot-toast, api.ts FormData fix |
| 2026-06-20 | Nova | Sprint 3 revision: removed react-hot-toast (not in package.json), added BackendError shared component, inline Drive 503 fallback, inline form validation errors, candidateId-based modal fetch, candidate count badge on tab |
| 2026-06-20 | Forge | Sprint 3 (tasks 3.1-3.4, 3.8-3.9): jobs.py status filter, candidates.py full rewrite (upload+422+500 fallbacks, drive 503, list, detail), resume_tasks.py full rewrite (extract+parse+embed, all fallbacks, fixed parsing_status field), config.py GOOGLE_DRIVE_CREDENTIALS_JSON, INTERFACE.md |
| 2026-06-22 | Goku | Live environment fixes: fixed duplicate alembic migrations (001 vs 0001), fixed migration ID types (Integer→UUID for all tables), fixed CORS (wildcard+credentials not allowed), fixed jobId type (Number→string UUID) in frontend, fixed `parsing_status`→`parse_status` in model/schema/tasks/routes, fixed greenlet DLL (VC++ redist), fixed Celery asyncpg event loop issue (NullPool via get_celery_db), added psycopg2-binary for alembic sync driver. Full pipeline verified working end-to-end. |
| 2026-06-22 | Nova | P0 bug fixes (pre-Sprint 4): api.ts — Job.id/Candidate.id/Candidate.job_id changed number→string; experience fields renamed to experience_min/experience_max; Job.status union extended with 'active'\|'draft'. CandidatesTab.tsx — polling now covers 'parsed'+'embedding_done' statuses (cards no longer stuck). JobDetailPage.tsx — StatusBadge handles 'active' (indigo) and 'draft' (slate); experienceLabel() reads correct field names. |
| 2026-06-22 | Forge | Sprint 4: shortlist_service.py (cosine sim + GPT-4o assessment + upsert), shortlist_tasks.py (Celery task, NullPool, retry logic), shortlist.py routes full implementation (4.1–4.4), schemas.py ShortlistResultWithCandidateResponse, INTERFACE.md Sprint 4 endpoints |
| 2026-06-22 | Nova | Sprint 4 (tasks 4.8–4.11): ShortlistTab.tsx (skeleton/empty/in-progress/results states, score badges, recommendation badges, strengths/gaps chips, reason expand/collapse), RunShortlistButton in CandidatesTab (enabled gate, loading state, inline messages), HR Decision buttons (optimistic update), Feedback inline form. Types: ShortlistResultWithCandidate added to api.ts. JobDetailPage wired with shortlistTriggered state + ShortlistTab. |
| 2026-06-22 | Forge | Sprint 5: phone_validation.py (E.164 normalisation, Indian number rules), vapi_service.py (outbound call via Vapi REST API, sarvam voice, deepgram transcriber, screening prompt), screening_tasks.py (tasks.initiate_screening_call + tasks.process_screening_webhook, GPT-4o extraction, pass/fail/needs_review classifier), screening.py routes rewritten (trigger endpoint, webhook endpoint, results endpoint), config.py VAPI_PHONE_NUMBER_ID, INTERFACE.md Sprint 5 endpoints |
| 2026-06-22 | Nova | Sprint 5 (tasks 5.8–5.11): ScreeningTab.tsx (trigger section with unscreened approved candidates, phone pre-validation with amber warning, Start AI Screening button, result cards with structured fields grid, willingness badge, communication quality, expandable summary+transcript), polling every 8s while any call is pending/initiated/in_progress. ScreeningCall type + CallStatus + ScreeningResult types added to api.ts. JobDetailPage wired (stub replaced with ScreeningTab). |
| 2026-06-22 | Forge | Sprint 6: livekit_service.py (room creation, token gen, Egress recording), email_service.py (Resend integration, interview link emails), assessment_service.py (GPT-4o interview assessment pipeline), interview_tasks.py (Celery tasks for assessment), interviews.py routes (all interview endpoints), interview_agent.py (LiveKit AgentServer + @server.rtc_session, TurnHandlingOptions, ai.coustics noise cancellation, preemptive_generation for Indian English, real-time transcript via conversation_item_added, assessment triggered post-transcript to fix race condition), models.py updated (egress_id field), .env updated (RESEND_API_KEY, LiveKit credentials) |
| 2026-06-22 | Nova | Sprint 6 (candidate-app): InterviewLandingPage.tsx (token validation, 4 states: valid/invalid/completed/expired), InterviewRoomPage.tsx (LiveKit video+audio, side-by-side layout, waveform animation, speaking indicators, mic toggle, end interview confirmation), InterviewCompletePage.tsx (success state, next steps). HR App: InterviewsTab.tsx (interview session list, status badges, View Report links), ReportPage.tsx (overall score, 5 dimension score bars, JD fit, strengths/weaknesses, transcript). JobDetailPage.tsx wired with Interviews tab. |
| 2026-06-22 | Goku | Sprint 6 post: state.json updated, CONTEXT.md updated. Sprint 7 queued (final POC sprint). |
