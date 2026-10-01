# SPRINTS.md — AI Recruitment Screening & Interview POC
*Written by Kira 📋 | 2026-06-19*

**Project:** AI Recruitment Screening & Interview POC  
**Owner:** Pranav (Co-founder, Webknot)  
**Type:** POC — local dev, no production deployment  
**Active Team:** Pixel, Forge, Nova, Sage, Warden, Sentinel

---

## Sprint Overview

| Sprint | Name | Owner(s) | Focus |
|--------|------|----------|-------|
| Sprint 1 | Design & Prototype | Pixel | All screens designed + runnable React prototype |
| Sprint 2 | Foundation | Forge, Nova | Backend infra + frontend scaffolds |
| Sprint 3 | Jobs & Resume Pipeline | Forge, Nova, Sage | Job CRUD + resume upload + AI parsing + embeddings |
| Sprint 4 | AI Shortlisting & HR Review | Forge, Nova, Sage | Shortlist scoring + HR decision/feedback UI |
| Sprint 5 | AI Voice Screening | Forge, Nova, Sage | Vapi.ai outbound calls + Sarvam AI + webhook handling |
| Sprint 6 | LiveKit Interview | Forge, Nova, Sage | Interview links + email + AI interview agent + Candidate App |
| Sprint 7 | Reports, Polish & Integration | Forge, Nova, Sage | Interview reports + dashboard + end-to-end pipeline |

---

## Sprint 1 — Design & Prototype
**Owner:** Pixel  
**Gate:** Pranav opens prototype in browser and says "looks good" → Sprint 2 unlocks  
⚠️ **Hard Rule:** Sprint 2 CANNOT start until this gate passes. No exceptions.

| ID | Task | Owner | Depends On |
|----|------|-------|------------|
| 1.1 | Design HR App wireframes — all screens: Jobs list, Create job form, Job detail, Upload resumes, Candidates list, Candidate detail, Shortlist review, Screening management, Screening result card, Interview management, Interview report | Pixel | — |
| 1.2 | Design Candidate App wireframes — all screens: Interview landing (token page), Interview room (LiveKit UI), Completion confirmation | Pixel | — |
| 1.3 | Define design system: colour palette, typography, spacing, component styles (shadcn/ui + Tailwind tokens) | Pixel | 1.1, 1.2 |
| 1.4 | Build runnable React prototype — HR App: all pages stubbed with realistic data, navigation working, `npm run dev` runs cleanly | Pixel | 1.1, 1.3 |
| 1.5 | Build runnable React prototype — Candidate App: all pages stubbed, `npm run dev` runs cleanly | Pixel | 1.2, 1.3 |

**Acceptance Criteria:**
- [ ] All HR App screens wireframed and visually complete
- [ ] All Candidate App screens wireframed and visually complete
- [ ] Design system defined (colours, typography, components)
- [ ] Both apps run with `npm run dev` without errors
- [ ] HR App navigation between pages works (Jobs → Job Detail → Candidates → Shortlist → Screening → Reports)
- [ ] Candidate App flow works (Landing → Interview Room → Completion)
- [ ] Pranav has opened both apps in a browser and said "looks good" ← **gate condition**

---

## Sprint 2 — Foundation
**Owner:** Forge, Nova  
**Gate (to unlock Sprint 3):** Warden REVIEW_PASS + Sentinel QA_PASS  
**Pre-condition:** Sprint 1 design gate must be PASS before this sprint starts

| ID | Task | Owner | Depends On |
|----|------|-------|------------|
| 2.1 | `docker-compose.yml` — PostgreSQL 15 + pgvector extension + Redis; `README.md` with local setup instructions | Forge | — |
| 2.2 | FastAPI project scaffold — directory structure per SPEC.md (`api/`, `models/`, `schemas/`, `services/`, `tasks/`, `core/`), `requirements.txt`, `.env.example` | Forge | — |
| 2.3 | Core config — `core/config.py` (Pydantic Settings, all env vars: DB URL, Redis, OpenAI key, Vapi key, Sarvam key, LiveKit, Resend), `core/database.py` (SQLAlchemy async engine + session factory) | Forge | 2.2 |
| 2.4 | SQLAlchemy ORM models — all 6 entities: `Job`, `Candidate`, `ShortlistResult`, `ScreeningCall`, `InterviewSession`, `InterviewReport` (fields exactly as per SPEC.md Section 4) | Forge | 2.3 |
| 2.5 | Alembic setup + initial migration — all 6 tables including pgvector column on `Candidate` (resume embedding); migration runs cleanly on fresh DB | Forge | 2.4 |
| 2.6 | Celery + Redis worker setup — `core/celery_app.py`, worker entrypoint, beat scheduler (if needed), confirm task discovery works | Forge | 2.3 |
| 2.7 | Base Pydantic schemas — request/response schemas for all models, covering all fields from SPEC.md | Forge | 2.4 |
| 2.8 | Health check endpoint (`GET /health`), CORS middleware (allow all origins for POC), global exception handler (returns consistent JSON error shape) | Forge | 2.3 |
| 2.9 | HR App scaffold — Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui + React Router v6 + TanStack Query; matches Pixel's design system tokens | Nova | — |
| 2.10 | Candidate App scaffold — same stack as HR App, add `@livekit/components-react` + `livekit-client` dependencies | Nova | — |
| 2.11 | HR App: layout shell — nav sidebar, top bar, page container, responsive layout matching Pixel prototype | Nova | 2.9 |
| 2.12 | Candidate App: layout shell — minimal centered layout matching Pixel prototype | Nova | 2.10 |
| 2.13 | Shared API client — Axios instance with base URL from env, TanStack Query `QueryClient` setup, global error toast on 4xx/5xx | Nova | 2.9, 2.10 |

**Acceptance Criteria:**
- [ ] `docker-compose up` starts PostgreSQL + Redis without errors
- [ ] pgvector extension is enabled and accessible
- [ ] `alembic upgrade head` runs cleanly and creates all 6 tables
- [ ] FastAPI app starts (`uvicorn app.main:app`) without errors
- [ ] `GET /health` returns `{"status": "ok"}`
- [ ] Celery worker starts and is discoverable via Redis
- [ ] HR App runs (`npm run dev`) without errors, layout renders
- [ ] Candidate App runs (`npm run dev`) without errors, layout renders
- [ ] Both apps show Pixel's design system styles (correct colours, fonts, components)
- [ ] `.env.example` documents all required environment variables

---

## Sprint 3 — Jobs & Resume Pipeline
**Owner:** Forge, Nova, Sage  
**Gate (to unlock Sprint 4):** Warden REVIEW_PASS + Sentinel QA_PASS

| ID | Task | Owner | Depends On |
|----|------|-------|------------|
| 3.1 | Job CRUD API — `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:id`, `PATCH /api/jobs/:id`; validate required fields; return structured JSON responses per Pydantic schemas | Forge | 2.7, 2.8 |
| 3.2 | Resume upload endpoint — `POST /api/jobs/:id/resumes`; accept single/multiple files (PDF + DOCX); store to `/uploads/resumes/{job_id}/`; create `Candidate` records (status: pending_parse); return candidate IDs immediately | Forge | 2.4, 2.7 |
| 3.3 | Celery task: raw text extraction — `tasks/resume_tasks.py`; PyMuPDF for PDF, python-docx for DOCX; store `resume_raw_text` on Candidate; trigger parsing task on completion | Forge | 2.6, 3.2 |
| 3.4 | Google Drive import endpoint — `POST /api/jobs/:id/resumes/drive`; accept Drive folder/file link; use Google Drive API v3 to download PDF/DOCX files; trigger same extraction pipeline as 3.3 | Forge | 3.3 |
| 3.5 | GPT-4o resume parsing service — `services/resume_parser.py`; structured JSON extraction prompt (skills, experience, education, companies, projects); JSON mode enabled; update `Candidate.parsed_data` on completion | Sage | 3.3 |
| 3.6 | OpenAI embeddings service — `services/embedding_service.py`; generate text-embedding-3-small embedding from `resume_raw_text`; store vector in pgvector column on `Candidate` | Sage | 3.5 |
| 3.7 | Celery task chain wiring — `tasks/resume_tasks.py`: extract raw text → GPT-4o parse → generate embedding; each step updates Candidate status (parsing → parsed → embedding_done → ready); handle failures gracefully with status=parse_failed | Sage | 3.3, 3.5, 3.6 |
| 3.8 | Candidate list endpoint — `GET /api/jobs/:id/candidates`; return all candidates with parsing status + parsed_data summary | Forge | 3.7 |
| 3.9 | Candidate detail endpoint — `GET /api/candidates/:id`; return full candidate record including all parsed fields | Forge | 3.7 |
| 3.10 | HR App: Jobs list page — table of all jobs (title, status, candidate count); "Create Job" button opens modal with form (title, description, required_skills, experience range, screening_criteria, interview_evaluation_criteria) | Nova | 3.1 |
| 3.11 | HR App: Job detail page — job info header; tabs: Candidates / Shortlist / Screening / Interviews; candidate count badge per tab | Nova | 3.1, 3.10 |
| 3.12 | HR App: Resume upload area — drag-and-drop file picker (PDF/DOCX); Google Drive URL input; upload progress indicator; displays uploaded file count | Nova | 3.2, 3.11 |
| 3.13 | HR App: Candidates list — card grid per candidate showing name, email, parsing status badge (pending / parsing / ready / failed); polling for status updates while parsing in progress | Nova | 3.8, 3.12 |
| 3.14 | HR App: Candidate detail modal/page — full parsed profile: skills chips, experience timeline, education, companies; resume file download link | Nova | 3.9, 3.13 |

**Acceptance Criteria:**
- [ ] Job can be created, listed, fetched, and updated via API
- [ ] PDF and DOCX resumes can be uploaded (single and bulk)
- [ ] Google Drive link imports files and triggers same pipeline
- [ ] Celery tasks run end-to-end: extract → parse → embed
- [ ] Candidate `parsed_data` is populated with structured fields after pipeline completes
- [ ] Candidate embedding is stored in pgvector
- [ ] `GET /api/jobs/:id/candidates` returns candidates with status
- [ ] HR App: Can create a job and see it in the list
- [ ] HR App: Can upload resumes and see parsing progress update live
- [ ] HR App: Can view full parsed candidate profile
- [ ] All API errors return consistent JSON shape

---

## Sprint 4 — AI Shortlisting & HR Review
**Owner:** Forge, Nova, Sage  
**Gate (to unlock Sprint 5):** Warden REVIEW_PASS + Sentinel QA_PASS

| ID | Task | Owner | Depends On |
|----|------|-------|------------|
| 4.1 | Shortlisting trigger endpoint — `POST /api/jobs/:id/shortlist`; validate all candidates have status=ready before allowing trigger; dispatch batch Celery task; return job_id + task_id | Forge | 3.7, 3.8 |
| 4.2 | Shortlist results endpoint — `GET /api/jobs/:id/shortlist`; return all ShortlistResult records for a job with candidate summary | Forge | 4.5 |
| 4.3 | HR decision endpoint — `PATCH /api/shortlist/:id/decision`; accept `hr_decision` (approved/rejected/overridden) + optional `hr_comments`; update ShortlistResult | Forge | 4.1 |
| 4.4 | HR feedback endpoint — `POST /api/shortlist/:id/feedback`; accept `hr_feedback_type` (correctly_shortlisted / incorrectly_shortlisted / correctly_rejected / incorrectly_rejected) + `hr_comments`; store for future context | Forge | 4.3 |
| 4.5 | Cosine similarity scoring service — `services/shortlist_service.py`; generate JD embedding once per job; compute cosine similarity vs each candidate's pgvector embedding; return ranked similarity scores | Sage | 3.6 |
| 4.6 | GPT-4o shortlist scoring prompt — system prompt combining JD + candidate parsed_data + similarity score; return structured JSON: `match_score` (0-100), `recommendation` (shortlist/reject), `strengths[]`, `gaps[]`, `reason`; validate response shape | Sage | 4.5 |
| 4.7 | Celery batch shortlisting task — `tasks/shortlist_tasks.py`; iterate all ready candidates for a job; for each: cosine similarity → GPT-4o score → save ShortlistResult; update job with last_shortlisted_at | Sage | 4.5, 4.6 |
| 4.8 | HR App: "Run AI Shortlist" button — on Job detail page Candidates tab; disabled if any candidates still parsing; loading spinner + progress message while running | Nova | 4.1, 3.11 |
| 4.9 | HR App: Shortlist review page — candidate cards sorted by match_score descending; each card shows: name, score badge (colour-coded), recommendation chip (shortlist/reject), strengths/gaps summary | Nova | 4.2, 4.8 |
| 4.10 | HR App: Approve/Reject/Override decision UI — action buttons per candidate card; confirmation step before submit; shows hr_decision badge after submission; allows override (HR can approve a rejected candidate) | Nova | 4.3, 4.9 |
| 4.11 | HR App: Feedback modal — triggered after approve/reject; radio buttons for feedback type + free-text comment; thank-you state after submit | Nova | 4.4, 4.10 |

**Acceptance Criteria:**
- [ ] `POST /api/jobs/:id/shortlist` validates all candidates are parsed before running
- [ ] Celery batch task processes all candidates for a job
- [ ] Each candidate gets a `ShortlistResult` with match_score, recommendation, strengths, gaps
- [ ] GPT-4o returns valid structured JSON (no hallucinated fields)
- [ ] HR can approve, reject, or override each shortlist decision
- [ ] HR can submit feedback (correctly_shortlisted etc.) + free text
- [ ] HR App: "Run AI Shortlist" button triggers and shows progress
- [ ] HR App: Shortlist cards display scores + strengths/gaps clearly
- [ ] HR App: Approve/Reject/Override works with confirmation
- [ ] HR App: Feedback modal submits and closes correctly

---

## Sprint 5 — AI Voice Screening
**Owner:** Forge, Nova, Sage  
**Gate (to unlock Sprint 6):** Warden REVIEW_PASS + Sentinel QA_PASS

| ID | Task | Owner | Depends On |
|----|------|-------|------------|
| 5.1 | Screening trigger endpoint — `POST /api/jobs/:id/screening/start`; validate all target candidates have `hr_decision=approved`; for each: validate phone number exists + is valid format; flag invalid/missing phones before dispatching calls | Forge | 4.3 |
| 5.2 | Vapi.ai webhook endpoint — `POST /api/vapi/webhook`; handle event types: `call-started`, `call-ended`, `transcript`; parse webhook payload; route to appropriate handlers; return 200 immediately | Forge | 5.5 |
| 5.3 | Screening result endpoint — `GET /api/candidates/:id/screening`; return ScreeningCall record with all extracted fields + result | Forge | 5.6 |
| 5.4 | Phone number validation service — `services/phone_validator.py`; check extracted phone from parsed_data; validate Indian mobile format (10-digit, +91 prefix etc.); return `valid: bool` + `formatted: str` | Forge | — |
| 5.5 | Vapi.ai outbound call service — `services/vapi_service.py`; Vapi REST API call creation with: phone number, assistant config (system prompt: JD + screening_criteria + candidate name), STT=Sarvam Saaras v3, TTS=Sarvam Bulbul v3, structured output config; save `vapi_call_id` to ScreeningCall | Sage | 5.1, 5.4 |
| 5.6 | Webhook processing service — `services/screening_processor.py`; on `call-ended`: send transcript to GPT-4o with extraction prompt → structured fields (availability, employment_status, relevant_experience, current_ctc, expected_ctc, notice_period, location_preference, communication_quality, willingness_to_proceed, summary); save to ScreeningCall | Sage | 5.2 |
| 5.7 | Pass/Fail/Needs Review classifier — `services/screening_classifier.py`; rule-based + GPT-4o reasoning: apply screening_criteria to extracted fields → `result` (pass/fail/needs_review); include classification reasoning in summary | Sage | 5.6 |
| 5.8 | HR App: Screening management page — list of approved candidates with screening status per candidate (not_started / calling / completed / failed); "Start Screening" button (triggers all approved candidates); status polling | Nova | 5.1, 5.3 |
| 5.9 | HR App: Phone number validation UI — before starting screening, show candidates with missing/invalid phone; inline edit field for HR to enter phone manually; cannot start screening until all phones are valid | Nova | 5.4, 5.8 |
| 5.10 | HR App: Screening result card — per candidate: summary text, structured fields table (CTC, notice period, availability etc.), Pass/Fail/Needs Review badge with colour coding, communication quality indicator | Nova | 5.3, 5.8 |
| 5.11 | HR App: Screening status polling — real-time status updates while calls are in progress (poll GET /api/candidates/:id/screening every 10s); show "In Progress" state while Vapi call is live | Nova | 5.3, 5.8 |

**Acceptance Criteria:**
- [ ] `POST /api/jobs/:id/screening/start` validates approved candidates + phone numbers before dispatching
- [ ] Candidates with missing/invalid phones are flagged before screening starts (not silently skipped)
- [ ] Vapi.ai call is created with correct Sarvam STT/TTS configuration
- [ ] Vapi webhook receives call events and stores transcript
- [ ] GPT-4o extracts all structured screening fields from transcript
- [ ] Pass/Fail/Needs Review result is generated and saved
- [ ] HR App: Shows phone validation warnings before screening starts
- [ ] HR App: HR can manually enter/edit phone numbers
- [ ] HR App: Shows live screening status while calls in progress
- [ ] HR App: Screening result card displays all extracted fields + result badge

---

## Sprint 6 — LiveKit Interview
**Owner:** Forge, Nova, Sage  
**Gate (to unlock Sprint 7):** Warden REVIEW_PASS + Sentinel QA_PASS

| ID | Task | Owner | Depends On |
|----|------|-------|------------|
| 6.1 | Interview session creation endpoint — `POST /api/candidates/:id/interview/send`; validate candidate has screening result = pass; generate UUID token; create `InterviewSession` record (status: pending); dispatch email Celery task | Forge | 5.7 |
| 6.2 | Resend email integration — `services/email_service.py`; send interview link email with template: subject `[Interview Invitation] {Job Title} at Webknot`, body with candidate name + unique URL; update `InterviewSession.email_sent_at` on success | Forge | 6.1 |
| 6.3 | Candidate session endpoint — `GET /api/interview/:token`; return session details (job title, candidate name, status); return 404 if token invalid, 410 if expired/completed | Forge | 6.1 |
| 6.4 | Interview start endpoint — `POST /api/interview/:token/start`; validate session status=pending; create LiveKit room; generate participant access token; update session status=in_progress + started_at; return room name + token | Forge | 6.7 |
| 6.5 | Interview complete endpoint — `POST /api/interview/:token/complete`; mark session status=completed + completed_at; dispatch assessment Celery task | Forge | 6.1 |
| 6.6 | LiveKit webhook endpoint — `POST /api/livekit/webhook`; handle `room_finished` event → trigger completion if not already triggered | Forge | 6.4 |
| 6.7 | LiveKit Cloud service — `services/livekit_service.py`; create room (room name = `interview-{session_id}`); generate candidate participant token + agent participant token; room config (max participants: 2, auto-close on empty) | Sage | — |
| 6.8 | LiveKit AI interview agent — `services/interview_agent.py`; LiveKit Agents SDK + OpenAI Realtime API; system prompt built from: job JD + candidate parsed_data (skills, experience) + screening result summary + `interview_evaluation_criteria`; conversational interview flow; store transcript on agent close | Sage | 6.7 |
| 6.9 | GPT-4o interview assessment service — `services/assessment_service.py`; transcript → structured InterviewReport: `technical_fit_score`, `communication_score`, `problem_solving_score`, `experience_score`, `role_alignment_score`, `overall_score` (0-100), `strengths[]`, `weaknesses[]`, `jd_fit`, `final_recommendation`, `summary`, `transcript_summary`; JSON mode; validate all scores present | Sage | 6.8 |
| 6.10 | Celery task: post-interview assessment pipeline — trigger on interview complete; run GPT-4o assessment; create InterviewReport record; update InterviewSession.transcript | Sage | 6.5, 6.9 |
| 6.11 | HR App: Interview management section — on Job detail page: list of pass-screened candidates; "Send Interview Link" button per candidate; shows email sent timestamp + interview status badge | Nova | 6.1, 6.3 |
| 6.12 | HR App: Interview status tracking — status chips (link_sent / interview_pending / in_progress / completed / report_ready); auto-refresh | Nova | 6.11 |
| 6.13 | Candidate App: Interview landing page — load session from token; display: job title, candidate name, instructions; "Start Interview" button; handle invalid token (404 page) and completed session (already done page) | Nova | 6.3 |
| 6.14 | Candidate App: Interview room — LiveKit `<LiveKitRoom>` component; audio/video controls; AI agent interaction UI; connection status indicator; "End Interview" button | Nova | 6.4, 6.13 |
| 6.15 | Candidate App: Completion confirmation screen — "Interview Complete" page with thank-you message; triggered after `POST /api/interview/:token/complete` | Nova | 6.5, 6.14 |

**Acceptance Criteria:**
- [ ] "Send Interview Link" creates session + sends email with working unique URL
- [ ] `GET /api/interview/:token` returns correct session or appropriate error
- [ ] `POST /api/interview/:token/start` creates LiveKit room and returns working token
- [ ] LiveKit AI agent joins the room and conducts a voice interview
- [ ] Interview transcript is captured and stored
- [ ] Post-interview Celery task generates complete InterviewReport
- [ ] All 6 scores (technical_fit, communication, problem_solving, experience, role_alignment, overall) are populated
- [ ] Candidate App: Token page loads correctly for valid tokens, errors correctly for invalid/expired
- [ ] Candidate App: Interview room connects to LiveKit, audio works, agent speaks
- [ ] Candidate App: Completion screen shows after interview ends
- [ ] HR App: Interview status updates after candidate completes

---

## Sprint 7 — Reports, Polish & Integration
**Owner:** Forge, Nova, Sage  
**Gate:** Warden REVIEW_PASS + Sentinel QA_PASS (final sprint — gates confirm POC success criteria are met)

| ID | Task | Owner | Depends On |
|----|------|-------|------------|
| 7.1 | Interview report endpoint — `GET /api/candidates/:id/report`; return full InterviewReport record; 404 if not yet generated | Forge | 6.10 |
| 7.2 | INTERFACE.md — complete documentation of all API endpoints (method, path, request/response shapes, auth, errors); required for project handoff | Forge | All Forge tasks |
| 7.3 | HR App: Interview report page — full assessment display: score dials/bars (6 scores), strengths chips, weaknesses chips, jd_fit paragraph, final_recommendation badge, transcript summary, overall score prominent header | Nova | 7.1 |
| 7.4 | HR App: Pipeline overview dashboard — main landing page; summary metrics: total jobs, total candidates, by pipeline stage (parsed / shortlisted / screened / interviewed / assessed); recent activity list | Nova | All Nova sprint tasks |
| 7.5 | HR App: Candidate full timeline — on Candidate detail: pipeline stage timeline (uploaded → parsed → shortlist result → screening result → interview status → report); all stage details accessible from one view | Nova | 7.3, 7.4 |
| 7.6 | HR App + Candidate App: Error states — empty states (no jobs yet, no candidates, no results), loading skeletons, error boundaries, toast notifications for async actions (success/error) | Nova | All Nova sprint tasks |
| 7.7 | GPT-4o prompt quality review — Sage reviews all prompts (resume parsing, shortlisting, screening extraction, assessment); ensure consistent JSON output, correct field names, no hallucination patterns; tune as needed | Sage | All Sage sprint tasks |
| 7.8 | End-to-end integration smoke test — Sage manually runs full pipeline: create job → upload resumes → parse → shortlist → screen → interview → assess; confirm data flows correctly across all services | Sage | All sprint tasks |

**Acceptance Criteria:**
- [ ] `GET /api/candidates/:id/report` returns complete InterviewReport
- [ ] INTERFACE.md documents every endpoint in the project
- [ ] HR App: Report page displays all 6 scores visually + recommendation clearly
- [ ] HR App: Dashboard shows pipeline metrics for active jobs
- [ ] HR App: Candidate timeline shows all pipeline stages in one view
- [ ] Both apps have proper empty states, loading states, and error states
- [ ] Toast notifications work for async actions (upload, shortlist trigger, screening trigger, link send)
- [ ] Full pipeline runs end-to-end without breaking (smoke test passes)
- [ ] **POC Success Criteria (from SPEC.md Section 11) — ALL must be checked:**
  - [ ] HR can create a job and upload resumes
  - [ ] System parses resumes into structured candidate profiles
  - [ ] System shortlists candidates based on JD
  - [ ] HR can review and give feedback on shortlist
  - [ ] AI voice screening can be triggered for shortlisted candidates
  - [ ] Qualified candidates receive interview links via email
  - [ ] Candidates can attend a LiveKit-based AI interview
  - [ ] HR can see a final AI-generated interview assessment report

---

## Dependencies Summary

```
Sprint 1 (Pixel)
    ↓ [Pranav design gate]
Sprint 2 (Foundation — Forge + Nova)
    ↓ [Warden + Sentinel gate]
Sprint 3 (Jobs + Resume Pipeline — Forge + Nova + Sage)
    ↓ [Warden + Sentinel gate]
Sprint 4 (Shortlisting — Forge + Nova + Sage)
    ↓ [Warden + Sentinel gate]
Sprint 5 (Voice Screening — Forge + Nova + Sage)
    ↓ [Warden + Sentinel gate]
Sprint 6 (LiveKit Interview — Forge + Nova + Sage)
    ↓ [Warden + Sentinel gate]
Sprint 7 (Reports + Polish — Forge + Nova + Sage)
    ↓ [Warden + Sentinel gate = POC Complete]
```

---

## Planning Notes

1. **No authentication** — POC intentionally skips auth. All API endpoints are open. Candidate App uses UUID tokens for interview access (not full auth).

2. **Celery task chain** — The resume pipeline (Sprint 3) is the most complex async sequence. Sage owns the AI steps, Forge owns the task wiring. They must coordinate on task status field values and error handling.

3. **Vapi.ai + Sarvam complexity** — Sprint 5 carries the highest integration risk. Sarvam AI is configured via Vapi's STT/TTS provider settings, not a direct SDK. Sage should validate this API contract with Vapi docs before starting Sprint 5.

4. **LiveKit AI agent** — Sprint 6 requires LiveKit Agents SDK (Python). This is a long-running process, not a simple API call. Sage needs to handle agent lifecycle (join room → conduct interview → leave → store transcript). This is the second highest risk item.

5. **Google Drive import** — Requires a Google Cloud OAuth app. Pranav needs to provide Google Cloud credentials before Sprint 3 starts.

6. **External service keys** — Before Sprint 3: OpenAI key needed. Before Sprint 5: Vapi.ai key + Sarvam AI key + phone number configuration. Before Sprint 6: LiveKit Cloud project + Resend API key. Pranav should provision all keys before their respective sprints.

7. **Nova can scaffold early** — In Sprint 2, Nova builds app scaffolds and layout shells from Pixel's design. In Sprint 3+, Nova wires real APIs. This parallel approach avoids Nova sitting idle while Forge builds the backend.

---
*Kira 📋 | Sprint plan for AI Recruitment Screening & Interview POC*
