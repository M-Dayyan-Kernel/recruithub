# INTERFACE.md — AI Recruitment POC
*Written by Forge — Sprint 7 (2026-06-22). Nova reads this before building any UI.*
*Keep it current — if you add/change an endpoint, update this file in the same session.*

---

## Base URL
- **Dev:** `http://localhost:8080`
- **HR App:** `http://localhost:5173`
- **Candidate App:** `http://localhost:5174`

## Auth
- **Type:** None (POC — no authentication layer)
- All endpoints are open

---

## Endpoints

---

### Jobs

#### `POST /api/jobs`
Create a new job posting.

**Request Body:**
```json
{
  "title": "string (required)",
  "description": "string (required)",
  "required_skills": ["string"],
  "experience_min": 0,
  "experience_max": 5,
  "screening_questions": [
    { "id": "uuid", "question": "string" }
  ],
  "interview_questions": [
    { "id": "uuid", "question": "string", "score": 25 }
  ],
  "status": "active | closed | draft | paused (default: active)"
}
```

**Response `201`:** `JobResponse`

**Errors:** `422` — validation error

---

#### `GET /api/jobs`
List all jobs. Optional status filter.

**Query params:** `?status=active|closed|draft|paused`

**Response `200`:** `JobResponse[]` — ordered by `created_at` desc

---

#### `GET /api/jobs/{job_id}`
Get a single job by UUID.

**Response `200`:** `JobResponse`

**Errors:** `404 Job not found`

---

#### `PATCH /api/jobs/{job_id}`
Partial update a job (any subset of fields).

**Request Body:** Same fields as `POST /api/jobs` — all optional

**Response `200`:** `JobResponse`

**Errors:** `404 Job not found`

---

#### `POST /api/jobs/parse-jd`
Upload a job description document (PDF or DOCX) and extract structured fields via AI.

**Request:** `multipart/form-data` with field `file` (PDF or DOCX, max 20 MB)

**Response `200`:**
```json
{
  "title": "string",
  "description": "string",
  "required_skills": ["string"],
  "experience_min": 0,
  "experience_max": 5,
  "screening_questions": [
    { "id": "uuid", "question": "string" }
  ],
  "interview_questions": [
    { "id": "uuid", "question": "string", "score": 25 }
  ]
}
```

**Errors:**
- `413` — file exceeds 20 MB
- `422` — unsupported file type, unreadable document, or no extractable content
- `500` — AI parsing failure

---

#### `DELETE /api/jobs/{job_id}`
Delete a job and all related records (candidates, shortlist results, screening calls, interview sessions).

**Response `204`:** No content

**Errors:** `404 Job not found`

---

### Candidates

#### `POST /api/jobs/{job_id}/resumes`
Upload one or more resume files (PDF or DOCX), or ZIP archives containing them. Triggers async parse pipeline.

**Request:** `multipart/form-data` with field `files` (multiple allowed). ZIP files may be mixed with individual PDF/DOCX uploads in the same request.

**ZIP behavior:** The server extracts PDF/DOCX members from each ZIP, including files in nested folders and nested ZIP archives. Paths are flattened for storage (e.g. `team/alice/cv.pdf` → `team_alice_cv.pdf`) so resumes in different folders are not lost to name collisions. Non-resume files inside a ZIP are ignored.

**Size limits:**
- Individual PDF/DOCX files: **20 MB** each (`413` aborts the request)
- ZIP archives: **100 MB** each (`413` aborts the request)
- Extracted members over 20 MB are skipped individually (`skipped_oversized` in response)
- Max **200** resumes per ZIP; max **500 MB** total uncompressed size per ZIP

**Response `202`:** `ResumeUploadResponse` *(updated Sprint B)*
```json
{
  "created": 2,
  "skipped": 1,
  "skipped_files": ["john_doe.pdf"],
  "candidate_ids": ["uuid1", "uuid2"],
  "extracted_from_zip": 4,
  "skipped_oversized": ["large_resume.pdf"]
}
```

**Errors:**
- `404` — job not found
- `413` — a file exceeds the size limit (20 MB for PDF/DOCX, 100 MB for ZIP)
- `422` — unsupported file type (only PDF / DOCX / ZIP accepted), or invalid/empty ZIP with no resumes
- `500` — upload directory creation failed

> **Nova gotcha:** Response shape changed in Sprint B — no longer returns `CandidateResponse[]`. Use `candidate_ids` to build any follow-up calls. `skipped_files` lists filenames that already existed for this job (dedup by filename). A 413 on a direct PDF/DOCX upload aborts the entire request — fix the oversized file and retry the whole batch. For ZIP uploads, oversized inner members are skipped without aborting other files.

> **Parse queue:** Only up to `MAX_CONCURRENT_PARSES` (default 10, env-configurable) resumes parse at once per job. Dispatched resumes show as `parse_queued` in the Upload tab until a Celery worker starts (`parsing`). Excess uploads stay `pending_parse` until a slot frees. When parsing finishes (`ready` or `parse_failed`), the next queued resume starts automatically.

---

#### `GET /api/jobs/{job_id}/candidates`
List candidates for a job.

**Query params (optional):**
- `parse_status` — comma-separated filter, e.g. `pending_parse` or `parsing,parsed`
- `has_shortlist_result` — `true` or `false` to filter candidates with/without a `ShortlistResult` row

**Response `200`:** `CandidateResponse[]` — ordered by `created_at` desc

**Errors:** `404` — job not found

---

#### `GET /api/candidates/{candidate_id}`
Get a single candidate by UUID.

**Response `200`:** `CandidateResponse`

**Errors:** `404 Candidate not found`

---

#### `PATCH /api/candidates/{candidate_id}` *(NEW — Sprint A)*
Partial update of candidate contact fields.

**Request Body (all fields optional):**
```json
{
  "name": "string | null",
  "email": "string | null",
  "phone": "string | null"
}
```

**Response `200`:** `CandidateResponse`

**Errors:** `404 Candidate not found`

> Only provided (non-null) fields are updated. Useful for HR to correct OCR errors in parsed contact details.

---

#### `DELETE /api/candidates/{candidate_id}` *(NEW — Sprint B-9)*
Delete a candidate and all related records (shortlist results, screening calls, interview sessions).

**Response `204`:** No content

**Errors:** `404 Candidate not found`

> Cascade delete is handled by SQLAlchemy ORM. All dependent records are removed automatically.

---

#### `POST /api/jobs/{job_id}/candidates/{candidate_id}/retry-parse` *(NEW — Sprint A)*
Re-queue resume parsing for a candidate whose parse failed or needs re-processing.

**Response `202`:**
```json
{ "status": "queued", "candidate_id": "uuid" }
```

**Errors:**
- `404` — candidate not found or doesn't belong to this job
- `422` — candidate is not in a retryable state (must be `parse_failed` or `ready`)

> **Nova gotcha:** After calling this, poll `GET /api/jobs/{job_id}/candidates` until `parse_status` returns to `ready` or `parse_failed`. The parse pipeline runs async (Celery).

---

### Shortlisting

#### `POST /api/jobs/{job_id}/shortlist`
Trigger AI shortlisting for eligible candidates (`parse_status = "ready"`, no existing `ShortlistResult`).

**Request Body (optional):**
```json
{
  "candidate_ids": ["uuid", "..."]
}
```
If `candidate_ids` is omitted, all eligible ready candidates are scored.

**Response `202`:**
```json
{
  "status": "shortlisting_started",
  "job_id": "uuid",
  "candidate_ids": ["uuid", "..."],
  "skipped": [{ "id": "uuid", "reason": "..." }]
}
```
`skipped` is present only when some requested IDs were ineligible.

**Errors:**
- `404` — job not found
- `409` — shortlisting already in progress for this job (Redis lock held) *(Sprint B-7)*
- `422` — no eligible candidates found (may include `skipped` array in detail)

> **Nova gotcha:** This is async. Poll `GET /api/jobs/{job_id}/shortlist/status` every 3s while `in_progress` is true, or poll `GET /api/jobs/{job_id}/shortlist` until results appear.

> **Concurrency:** Up to `MAX_CONCURRENT_SHORTLISTS` (default 10, env-configurable) GPT assessments run in parallel per batch. Results are saved incrementally so status polling shows progress as each candidate completes.

> **Nova gotcha (B-7):** `409 Conflict` means the Celery task is still running. Show the user a "Shortlisting already in progress" banner and suppress the trigger button until the lock clears (task takes 1–120s depending on candidate count). Lock auto-expires after 5 min in case of task crash.

---

#### `GET /api/jobs/{job_id}/shortlist/status`
Shortlist run progress for the AI Shortlisting tab.

**Response `200`:**
```json
{
  "in_progress": true,
  "candidate_ids": ["uuid", "..."],
  "completed": 2,
  "total": 5,
  "failed": 0
}
```

**Errors:** `404` — job not found

---

#### `GET /api/jobs/{job_id}/shortlist`
Get shortlist results for a job, enriched with candidate name and email.

**Response `200`:** `ShortlistResultWithCandidateResponse[]` — ordered by `match_score` desc

**Errors:** `404` — job not found

> **Nova gotcha:** Returns `[]` while shortlisting is still running (Celery task in progress). Treat empty array + shortlistTriggered=true as in-progress state, not error.

> **Nova gotcha:** `candidate_email` may be `null` if email was still a placeholder at shortlisting time (ends with `@upload.pending`).

---

#### `PATCH /api/shortlist/{shortlist_id}/decision`
Set HR decision on a shortlist entry.

**Request Body:**
```json
{ "hr_decision": "approved | rejected | overridden" }
```

**Response `200`:** `ShortlistResultResponse`

**Errors:**
- `404` — shortlist result not found
- `422` — invalid `hr_decision` value

> **Email:** On the first transition to `hr_decision = "rejected"`, a rejection email is sent via Gmail to the candidate (if a valid email is on file). Re-clicking Reject does not resend. Email failure does not roll back the decision.

> **Nova UI:** The **AI Shortlisted** tab uses this endpoint for per-card **Approve** / **Reject** buttons on each scored candidate card.

---

#### `POST /api/shortlist/{shortlist_id}/feedback`
Submit HR feedback on a shortlist entry.

**Request Body:**
```json
{
  "hr_feedback_type": "correctly_shortlisted | incorrectly_shortlisted | correctly_rejected | incorrectly_rejected",
  "hr_comments": "string | null"
}
```

**Response `200`:** `ShortlistResultResponse`

**Errors:** `404` — shortlist result not found

---

### Screening

#### `POST /api/jobs/{job_id}/screening/trigger`
Trigger AI voice screening calls for a set of HR-approved candidates.

**Request Body:**
```json
{
  "candidate_ids": ["uuid", "uuid", ...],
  "force": false
}
```
`force: true` — dial immediately even outside the job's call window (Start Calling Now / Call Now).  
`force: false` (default) — if outside window, calls are queued with Celery `countdown` until the window opens.

**Response `202`:**
```json
{
  "initiated": 3,
  "queued": 1,
  "skipped": [{ "name": "John Doe", "reason": "No phone number on file" }]
}
```

**Errors:**
- `404` — job not found
- `422` — `candidate_ids` missing or empty

> **Nova gotcha:** Only candidates with `hr_decision = "approved"` AND a valid phone number will be called. Others are silently skipped with a reason. Show `skipped` list to HR.

> **Nova gotcha:** Skips candidates who already have an active call (`pending`, `initiated`, `in_progress`). When `enforce_phone_geography` is on in system settings, only +91 numbers pass validation.

> **Call window:** Job fields `screening_call_from`, `screening_call_to`, `screening_timezone` (default `Asia/Kolkata`, 09:00–18:00). Auto-retries respect the window; manual `force: true` overrides.

> **Nova gotcha:** The webhook URL for Vapi is `POST /api/screening/webhook` — configure this in the Vapi dashboard.

---

#### `POST /api/screening/webhook`
Receive Vapi.ai call-end webhooks. **No auth required.** Do not call from frontend.

**Response `200`:** `{ "status": "received" }`

---

#### `GET /api/jobs/{job_id}/screening`
List all screening calls for a job.

**Response `200`:** `ScreeningCallResponse[]` — ordered by `created_at` desc

**Errors:** `404` — job not found

---

#### `PATCH /api/screening/{screening_id}/result`
Set HR decision on a completed screening call.

**Request Body:**
```json
{ "result": "pass | fail | needs_review" }
```

**Response `200`:** `ScreeningCallResponse`

**Errors:**
- `404` — screening call not found
- `422` — invalid result or call not yet completed

> **Nova UI:** Screening tab **Approve Pass** / **Reject Fail** buttons call this endpoint with `pass` or `fail`.

---

### Interviews

#### `GET /api/jobs/{job_id}/interviews` *(NEW — Sprint A — was listed as stub, now implemented)*
HR view: list all interview sessions for a job, enriched with `candidate_name` and `interview_url`.

**Response `200`:** `InterviewSessionResponse[]` — ordered newest-first

**Errors:** `404` — job not found

> **Nova gotcha:** `interview_url` is computed from `CANDIDATE_APP_URL` env var (default `http://localhost:5174`). `candidate_name` is batch-loaded via join — always present. `expires_at` is set (7 days from send) for sessions created after Sprint A.

---

#### `POST /api/candidates/{candidate_id}/interview/send`
Create an interview session and send the interview link to the candidate via email.

**Request Body:** None (candidate_id in path)

**Response `201`:** `InterviewSessionResponse` (includes `interview_url`, `candidate_name`, `job_title`)

**Errors:**
- `400` — candidate has not passed screening (`result != "pass"`)
- `404` — candidate not found
- `409` — active interview session already exists for this candidate

> **Nova gotcha:** `email_sent_at` is set if email succeeded; `null` if Gmail delivery failed. Session is still created either way — show the `interview_url` as fallback.

---

#### `GET /api/interview/{token}`
Candidate app: fetch session details using the unique token from the interview link.

**Response `200`:** `InterviewSessionResponse` (includes `candidate_name`, `job_title`)

**Errors:** `404 Interview session not found`

> **Nova gotcha:** Used by the candidate landing page to detect session state: `pending` = can start, `in_progress` = already started (guard against page refresh re-joining), `completed` = already done, `expired` = too old.

---

#### `POST /api/interview/{token}/start`
Start an interview — creates a LiveKit room and returns the candidate's access token.

**Response `200`:** `InterviewStartResponse`
```json
{
  "room_name": "interview-<session-uuid>",
  "token": "<livekit-jwt>",
  "livekit_url": "wss://..."
}
```

**Errors:**
- `404` — session not found
- `409` — interview already started (status is not `pending`)
- `502` — LiveKit room creation failed or token generation failed

> **Nova gotcha:** Only call this once. The atomic update ensures only one room is created even on double-click. If `409`, re-fetch session and redirect appropriately.

---

#### `POST /api/interview/{token}/complete`
Mark interview as completed. Returns immediately — assessment is generated async.

**Response `202`:**
```json
{ "message": "Interview marked complete. Assessment will be generated after transcript is saved.", "session_id": "uuid" }
```

**Errors:**
- `404` — session not found
- `409` — session not in a completable state

> **Nova gotcha:** Assessment is triggered by the interview agent (not this endpoint) after it saves the transcript. Polling `GET /api/candidates/{id}/report` until the report appears is the right pattern.

---

#### `POST /api/livekit/webhook`
Handle LiveKit room events (room_finished etc.). Do not call from frontend.

**Response `200`:** `{ "received": true, "event": "room_finished" }`

---

#### `GET /api/candidates/{candidate_id}/report`
Fetch the most recent interview report for a candidate.

**Response `200`:** `InterviewReportResponse` (includes all scores + `candidate_name` + `job_title`)

**Errors:** `404 Report not ready yet` — assessment still running or interview not yet complete

> **Nova gotcha:** Poll this endpoint after the interview completes. The assessment pipeline runs async (GPT-4o call via Celery task). Typically takes 10–30 seconds after interview ends. Show a loading/waiting state — do NOT treat `404` as a permanent failure here.

---

### Health

#### `GET /health`
Liveness check.

**Response `200`:** `{ "status": "ok", "version": "1.0.0" }`

---

### System Settings

#### `GET /api/settings`
Return system-wide settings (geography restrictions for outbound screening).

**Response `200`:**
```json
{
  "allowed_phone_regions": ["IN"],
  "enforce_phone_geography": true,
  "updated_at": "ISO 8601"
}
```

#### `PATCH /api/settings`
Update system settings.

**Request Body (partial):**
```json
{
  "enforce_phone_geography": true,
  "allowed_phone_regions": ["IN"]
}
```

**Response `200`:** `SystemSettingsResponse`

---

## Key Data Shapes

```typescript
// Job
interface Job {
  id: string;                          // UUID
  title: string;
  description: string;
  required_skills: string[] | null;
  experience_min: number;
  experience_max: number;
  screening_questions: Array<{ id: string; question: string }>;
  interview_questions: Array<{ id: string; question: string; score: number }>;
  interview_total_score: number;        // computed: sum of question scores
  screening_call_from: string | null;   // "HH:MM:SS" local job timezone
  screening_call_to: string | null;
  screening_timezone: string;         // IANA tz, default Asia/Kolkata
  status: "active" | "closed" | "draft" | "paused";
  created_at: string;                  // ISO 8601
  updated_at: string;
}

// Candidate
interface Candidate {
  id: string;                          // UUID
  job_id: string;
  name: string;                        // From filename until parse completes
  email: string;                       // Placeholder until parse completes (ends with @upload.pending)
  phone: string | null;
  resume_file_path: string | null;
  resume_raw_text: string | null;      // Avoid rendering — large field
  parsed_data: ParsedData | null;
  parse_status: ParseStatus;
  created_at: string;
}

type ParseStatus =
  | "pending_parse"      // waiting for a parse slot
  | "parse_queued"       // slot claimed, waiting for Celery worker
  | "parsing"            // text extraction running
  | "parsed"             // GPT-4o parse complete, embedding pending
  | "ready"              // fully processed — safe to shortlist
  | "parse_failed";      // pipeline error — manual review needed

interface ParsedData {
  name: string;
  email: string;
  phone: string | null;
  skills: string[];
  total_experience_years: number;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  current_company: string | null;
  current_role: string | null;
}

// ShortlistResult (with candidate enrichment)
interface ShortlistResultWithCandidate {
  id: string;
  candidate_id: string;
  job_id: string;
  match_score: number;                 // 0–100 float
  recommendation: "shortlisted" | "rejected" | "review";
  strengths: string[] | null;
  gaps: string[] | null;
  reason: string | null;
  hr_decision: "pending" | "approved" | "rejected" | "overridden";
  hr_feedback_type: string | null;
  hr_comments: string | null;
  created_at: string;
  candidate_name: string | null;
  candidate_email: string | null;      // null if still placeholder
}

// ScreeningCall
interface ScreeningCall {
  id: string;
  candidate_id: string;
  job_id: string;
  vapi_call_id: string | null;
  call_status: "pending" | "initiated" | "in_progress" | "completed" | "failed";
  availability: string | null;
  employment_status: string | null;
  relevant_experience: string | null;
  current_ctc: string | null;
  expected_ctc: string | null;
  notice_period: string | null;
  location_preference: string | null;
  communication_quality: string | null;
  willingness_to_proceed: boolean | null;
  summary: string | null;
  result: "pass" | "fail" | "needs_review" | null;
  transcript: string | null;
  ended_reason: string | null;    // Raw Vapi endedReason value (Sprint 8)
  call_outcome: "completed" | "no_answer" | "voicemail" | "declined" | "dropped" | "failed" | null;  // Classified outcome (Sprint 8)
  retry_count: number;            // How many retries have been attempted (Sprint 8)
  created_at: string;
}

// InterviewSession
interface InterviewSession {
  id: string;
  candidate_id: string;
  job_id: string;
  unique_token: string;
  livekit_room_name: string | null;
  status: "pending" | "in_progress" | "completed" | "expired";
  email_sent_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  egress_id: string | null;
  expires_at: string | null;         // ISO 8601 — 7 days from send; null for old sessions
  // Enriched
  interview_url: string | null;
  candidate_name: string | null;
  job_title: string | null;
}

// InterviewReport — full assessment from GPT-4o
interface InterviewReport {
  id: string;
  interview_session_id: string;
  candidate_id: string;
  job_id: string;
  summary: string | null;
  transcript_summary: string | null;
  technical_fit_score: number | null;    // 0–10
  communication_score: number | null;    // 0–10
  problem_solving_score: number | null;  // 0–10
  experience_score: number | null;       // 0–10
  role_alignment_score: number | null;   // 0–10
  overall_score: number | null;          // 0–10
  strengths: string[] | null;
  weaknesses: string[] | null;
  jd_fit: string | null;
  final_recommendation: string | null;
  raw_report: object | null;
  created_at: string;
  // Enriched (joined by backend)
  candidate_name: string | null;
  job_title: string | null;
  // Rubric-based assessment (when job had interview_questions)
  question_scores: Array<{
    id: string;
    question: string;
    score: number;
    earned_score: number | null;
    notes: string | null;
  }> | null;
  rubric_total: number | null;           // sum of rubric question weights
}
```

---

## Error Format
FastAPI default error format:
```json
{ "detail": "Human-readable message" }
```

Global exception handler (non-HTTP exceptions):
```json
{ "error": "ExceptionClassName", "detail": "message string" }
```

Common status codes:
| Code | Meaning |
|------|---------|
| `400` | Bad request (invalid input, business rule violation) |
| `404` | Resource not found |
| `409` | Conflict (duplicate active session, already started, etc.) |
| `422` | Unprocessable entity (validation failure, pre-condition not met) |
| `500` | Unexpected server error |
| `502` | Upstream service error (LiveKit, etc.) |
| `503` | Service not configured |

---

## Environment Variables Nova Needs
```env
VITE_API_URL=http://localhost:8080
```

---

## Gotchas for Nova

1. **parse_status polling** — After upload, poll `GET /api/jobs/{job_id}/candidates` every 5s while any candidate has `parse_status` in `["pending_parse", "parse_queued", "parsing", "parsed"]`. Stop polling when all are `"ready"` or `"parse_failed"`.

2. **Shortlist is async** — Empty `[]` from `GET /api/jobs/{job_id}/shortlist` means Celery task is still running. Do NOT show "No results" state immediately after triggering. Poll every 3s until results appear.

3. **AI Shortlisted tab** — Shows **all** scored candidates (shortlisted, rejected, needs review) with recommendation badges. Do not filter to `recommendation === 'shortlisted'` only.

4. **candidate_email placeholder** — `email.endsWith("@upload.pending")` means parse hasn't completed yet or email wasn't found in resume. Show `null` / dash in UI. `GET /shortlist` enriches `candidate_name` / `candidate_email` from `parsed_data` when available.

5. **Report 404 ≠ error** — `GET /api/candidates/{id}/report` returns `404 "Report not ready yet"` when assessment is still running. Show a polling skeleton/spinner, not an error page. Assessment typically takes 10–30 seconds.

6. **Interview session idempotency** — Calling `POST /api/interview/{token}/start` twice returns `409`. Handle this in the candidate app by detecting `409` and re-fetching session status.

7. **Email non-fatal** — `POST /api/candidates/{id}/interview/send` always creates the session even if email delivery fails. Check `email_sent_at` — if `null`, show the `interview_url` directly to HR so they can share it manually.

8. **Vapi webhook URL** — Must be configured in Vapi dashboard as `POST /api/screening/webhook` (with the server's public URL — use ngrok in dev). If not configured, screening results never arrive.

9. **Screening call_outcome** — New field (Sprint 8) on `ScreeningCallResponse`. Use `call_outcome` to drive UI state: `no_answer`/`voicemail`/`dropped` = show "Retrying" badge; `completed` = show result; `failed` = show error. `retry_count` (0–3) shows how many auto-retries have been scheduled. `ended_reason` is the raw Vapi string for debug purposes.

10. **Backend port** — Always `8080`. Port 8000 has Windows ghost TCP connections and must not be used.

11. **CORS** — Allowed origins: `5173`, `5174`, `5175`, `5176`, `5177`, `5178`, `127.0.0.1:5173`. If running on a different port, add it to `main.py` CORS allow_origins.

---

## Endpoint Quick Reference

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/jobs` | Create job |
| GET | `/api/jobs` | List jobs (`?status=`) |
| GET | `/api/jobs/{id}` | Get job |
| PATCH | `/api/jobs/{id}` | Update job |
| DELETE | `/api/jobs/{id}` | Delete job and related records |
| POST | `/api/jobs/{id}/resumes` | Upload resumes (multipart) |
| GET | `/api/jobs/{id}/candidates` | List candidates |
| GET | `/api/candidates/{id}` | Get candidate |
| PATCH | `/api/candidates/{id}` | Update candidate contact fields |
| POST | `/api/jobs/{id}/candidates/{id}/retry-parse` | Re-queue failed parse |
| POST | `/api/jobs/{id}/shortlist` | Trigger AI shortlisting |
| GET | `/api/jobs/{id}/shortlist/status` | Shortlist run progress |
| GET | `/api/jobs/{id}/shortlist` | Get shortlist results |
| PATCH | `/api/shortlist/{id}/decision` | HR approve/reject/override |
| POST | `/api/shortlist/{id}/feedback` | HR feedback |
| POST | `/api/jobs/{id}/screening/trigger` | Trigger voice screening |
| POST | `/api/screening/webhook` | Vapi webhook (internal) |
| GET | `/api/jobs/{id}/screening` | Get screening results |
| PATCH | `/api/screening/{id}/result` | HR pass/fail decision on screening |
| GET | `/api/jobs/{id}/interviews` | List interview sessions for job |
| POST | `/api/candidates/{id}/interview/send` | Send interview link |
| GET | `/api/interview/{token}` | Get session by token |
| POST | `/api/interview/{token}/start` | Start interview (get LiveKit token) |
| POST | `/api/interview/{token}/complete` | Mark interview complete |
| POST | `/api/livekit/webhook` | LiveKit webhook (internal) |
| GET | `/api/candidates/{id}/report` | Get interview report |
| GET | `/api/settings` | System settings (geography) |
| PATCH | `/api/settings` | Update system settings |
| GET | `/health` | Health check |

---

*Written by Forge — Sprint 7 — 2026-06-22*
*Updated by Forge after Sprint 7 on 2026-06-22*
