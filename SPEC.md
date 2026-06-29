# SPEC.md — AI Recruitment Screening & Interview POC

**Project:** AI Recruitment Screening & Interview POC  
**Owner:** Pranav (Co-founder, Webknot)  
**Status:** Draft — Awaiting Sign-off  
**Created:** 2026-06-19  
**Olympus Lead:** Goku  

---

## 1. Overview

A full-stack POC that automates the recruitment pipeline — from job creation to final AI interview assessment. Two applications: an **HR App** for managing the pipeline, and a **Candidate App** for attending the AI interview. No authentication required for this POC.

---

## 2. Applications

### 2.1 HR App
Web application used by HR to:
- Create and manage jobs
- Upload and manage resumes
- Review AI shortlist and provide feedback
- Trigger AI voice screening
- View screening results and interview reports

### 2.2 Candidate App
Web application used by candidates to:
- Access their interview via a unique link (no login)
- Attend a LiveKit-based AI video/audio interview
- Receive a completion confirmation

---

## 3. Tech Stack

### Frontend
| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build Tool | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| State / Data Fetching | TanStack Query (React Query) |
| Routing | React Router v6 |
| LiveKit (Candidate App) | `@livekit/components-react` + `livekit-client` |

### Backend
| Layer | Technology |
|-------|-----------|
| Runtime | Python 3.11+ |
| Framework | FastAPI |
| ORM | SQLAlchemy + Alembic (migrations) |
| Task Queue | Celery + Redis (for async resume parsing, AI calls) |
| File Storage | Local filesystem (POC) — S3-compatible path for future |

### Database
| Purpose | Technology |
|---------|-----------|
| Primary DB | PostgreSQL 15 |
| Vector Search | pgvector extension (resume embeddings for matching) |
| Cache / Queue | Redis |

### AI & Integrations
| Capability | Provider |
|-----------|---------|
| Resume Parsing | OpenAI GPT-4o (structured extraction via JSON mode) |
| Resume Shortlisting | OpenAI Embeddings + GPT-4o (match scoring) |
| AI Voice Screening (orchestration) | Vapi.ai (outbound call orchestration, webhooks, structured output) |
| AI Voice Screening (STT) | Sarvam AI — Saaras v3 (23 Indian languages + English, code-mix / Hinglish) |
| AI Voice Screening (TTS) | Sarvam AI — Bulbul v3 (natural Indian TTS, telephony-optimized) |
| AI Interview | LiveKit + OpenAI Realtime API (voice conversation) |
| Interview Assessment | OpenAI GPT-4o (transcript → structured report) |
| Email (interview links) | Resend |
| Resume file parsing | PyMuPDF (PDF) + python-docx (DOCX) |
| Google Drive import | Google Drive API v3 |

---

## 4. Data Models

### Job
```
id, title, description, required_skills (array), experience_min, experience_max,
screening_criteria (text), interview_evaluation_criteria (text),
status (draft/active/closed), created_at, updated_at
```

### Candidate
```
id, job_id, name, email, phone,
resume_file_path, resume_raw_text,
parsed_data (JSON: skills, experience, education, companies, projects),
created_at
```

### ShortlistResult
```
id, candidate_id, job_id,
match_score (0-100), recommendation (shortlist/reject),
strengths (array), gaps (array), reason (text),
hr_decision (approved/rejected/overridden/pending),
hr_feedback_type (correctly_shortlisted/incorrectly_shortlisted/correctly_rejected/incorrectly_rejected),
hr_comments (text),
created_at
```

### ScreeningCall
```
id, candidate_id, job_id,
vapi_call_id, call_status (pending/in_progress/completed/failed),
availability (text), employment_status, relevant_experience (text),
current_ctc, expected_ctc, notice_period, location_preference,
communication_quality (text), willingness_to_proceed (bool),
summary (text), result (pass/fail/needs_review),
transcript (text), created_at
```

### InterviewSession
```
id, candidate_id, job_id,
unique_token (UUID, used in link), livekit_room_name,
status (pending/in_progress/completed/expired),
email_sent_at, started_at, completed_at,
transcript (text), created_at
```

### InterviewReport
```
id, interview_session_id, candidate_id, job_id,
summary (text), transcript_summary (text),
technical_fit_score (0-10), communication_score (0-10),
problem_solving_score (0-10), experience_score (0-10),
role_alignment_score (0-10), overall_score (0-100),
strengths (array), weaknesses (array),
jd_fit (text), final_recommendation (text),
raw_report (JSON), created_at
```

---

## 5. API Surface

### Jobs
```
POST   /api/jobs                    → Create job
GET    /api/jobs                    → List jobs
GET    /api/jobs/:id                → Get job detail
PATCH  /api/jobs/:id                → Update job
```

### Candidates / Resumes
```
POST   /api/jobs/:id/resumes        → Upload single/multiple resumes
POST   /api/jobs/:id/resumes/drive  → Import from Google Drive link
GET    /api/jobs/:id/candidates     → List candidates for a job
GET    /api/candidates/:id          → Get candidate detail
```

### Shortlisting
```
POST   /api/jobs/:id/shortlist      → Trigger AI shortlisting for all parsed resumes
GET    /api/jobs/:id/shortlist      → Get shortlist results
PATCH  /api/shortlist/:id/decision  → HR approves / rejects / overrides
POST   /api/shortlist/:id/feedback  → HR submits feedback
```

### Screening
```
POST   /api/jobs/:id/screening/start        → Trigger AI voice screening for approved candidates
GET    /api/candidates/:id/screening        → Get screening result
POST   /api/vapi/webhook                    → Vapi.ai webhook (call events + transcript)
```

### Interviews
```
POST   /api/candidates/:id/interview/send   → Send interview link email
GET    /api/interview/:token                → Candidate app: get session by token
POST   /api/interview/:token/start          → Start LiveKit room, get access token
POST   /api/interview/:token/complete       → Mark interview complete, trigger assessment
GET    /api/candidates/:id/report           → Get final interview report
POST   /api/livekit/webhook                 → LiveKit webhook (room events)
```

---

## 6. Key Flows (Technical)

### 6.1 Resume Upload & Parsing
1. HR uploads file(s) → stored to `/uploads/resumes/`
2. Celery task triggered: extract raw text (PyMuPDF / python-docx)
3. Raw text + job JD sent to GPT-4o with structured JSON prompt → parsed Candidate record
4. Embedding generated for candidate resume text (stored in pgvector)
5. HR sees parsed candidate card in UI

### 6.2 AI Shortlisting
1. HR clicks "Run AI Shortlist" on a job
2. Celery task: for each parsed candidate, cosine similarity (embedding) + GPT-4o scoring prompt
3. GPT-4o returns: match_score, recommendation, strengths[], gaps[], reason
4. Results saved as ShortlistResult records
5. HR reviews, approves/rejects/overrides each candidate
6. HR feedback stored for future context injection

### 6.3 AI Voice Screening (Vapi.ai)
1. HR clicks "Start Screening" for approved candidates
2. Backend creates a Vapi.ai call via API with:
   - Phone number from candidate profile (auto-extracted from resume; if missing/invalid → HR is warned and must enter it manually before screening can start)
   - System prompt built from: job JD + screening criteria + candidate name
   - STT provider set to Sarvam Saaras v3 (handles Indian accents, regional dialects, Hinglish)
   - TTS provider set to Sarvam Bulbul v3 (natural-sounding Indian voice)
3. Vapi calls the candidate, conducts structured screening conversation
4. On call end: Vapi webhook fires → backend parses transcript → GPT-4o extracts structured fields (CTC, notice period, etc.) → generates Pass/Fail/Needs Review
5. HR sees screening summary card per candidate

### 6.4 Interview Link Generation & Delivery
1. HR clicks "Send Interview Link" for passed screening candidates
2. Backend generates unique UUID token → creates InterviewSession record
3. Resend API sends email: `[Interview Link] - {Job Title} at Webknot`
4. Email contains unique URL: `https://<candidate-app>/<token>`

### 6.5 LiveKit AI Interview
1. Candidate opens link → Candidate App loads session details
2. Candidate clicks "Start Interview" → backend creates LiveKit room, returns room token
3. Backend spins up an AI agent (LiveKit Agents SDK + OpenAI Realtime API):
   - System prompt: job JD + candidate resume + screening result + interview evaluation criteria
   - Agent conducts conversational interview (voice)
4. Interview ends (candidate or agent closes) → backend triggered via LiveKit webhook
5. Celery task: transcript → GPT-4o assessment prompt → InterviewReport generated
6. HR sees full report in dashboard

---

## 7. Project Structure

```
ai-recruitment-poc/
├── backend/                    # FastAPI backend
│   ├── app/
│   │   ├── api/               # Route handlers
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic schemas
│   │   ├── services/          # Business logic (AI, Vapi, LiveKit, email)
│   │   ├── tasks/             # Celery tasks
│   │   └── core/              # Config, DB, Redis setup
│   ├── alembic/               # DB migrations
│   └── requirements.txt
├── hr-app/                     # HR React application
│   ├── src/
│   │   ├── pages/             # Jobs, Candidates, Shortlist, Screening, Reports
│   │   ├── components/
│   │   └── api/               # API client
│   └── package.json
├── candidate-app/              # Candidate React application
│   ├── src/
│   │   ├── pages/             # Interview page
│   │   └── components/        # LiveKit components
│   └── package.json
├── docker-compose.yml          # PostgreSQL + Redis + pgvector
└── README.md
```

---

## 8. External Services & Keys Required

| Service | Purpose | Notes |
|---------|---------|-------|
| OpenAI API | Resume parsing, shortlisting, assessment | GPT-4o + Embeddings |
| Vapi.ai | Outbound call orchestration | Needs phone number config; configure Sarvam as STT/TTS provider |
| Sarvam AI | Indian language STT (Saaras v3) + TTS (Bulbul v3) | Excellent for Indian accents, dialects, Hinglish code-mixing |
| LiveKit Cloud | Real-time interview rooms | Or self-hosted |
| Resend | Transactional email (interview links) | Free tier sufficient for POC |
| Google Cloud | Google Drive API (resume import) | Needs OAuth app |

---

## 9. Out of Scope (POC)

- Authentication / login
- Role-based access control
- Full ATS integration
- Calendar / scheduling
- Offer management
- HRMS integration
- Production ML model training
- Advanced analytics
- Multi-tenant setup
- Mobile apps

---

## 10. Open Questions — RESOLVED ✅

1. ✅ **Phone numbers** — Extracted from resume automatically. If missing/invalid, HR is warned and prompted to enter manually before screening starts.
2. ✅ **Google Drive** — PDF/DOCX files stored in Drive only. No Google Docs native format.
3. ✅ **LiveKit hosting** — LiveKit Cloud.
4. ✅ **Interview email** — Standard template.
5. ✅ **Deployment** — Local dev machine for POC.
6. ✅ **Voice provider** — Sarvam AI (Saaras v3 STT + Bulbul v3 TTS) via Vapi.ai for Indian dialect/accent support.

---

## 11. Success Criteria (from PRD)

- [ ] HR can create a job and upload resumes
- [ ] System parses resumes into structured candidate profiles
- [ ] System shortlists candidates based on JD
- [ ] HR can review and give feedback on shortlist
- [ ] AI voice screening can be triggered for shortlisted candidates
- [ ] Qualified candidates receive interview links via email
- [ ] Candidates can attend a LiveKit-based AI interview
- [ ] HR can see a final AI-generated interview assessment report

---

_Sign-off required from Pranav before sprint planning begins._
