# AI Recruitment Screening & Interview POC

Full-stack AI recruitment pipeline — HR App + Candidate App.

---

## Prerequisites

- Docker Desktop (for PostgreSQL + Redis)
- Python 3.11+
- Node.js 20+ (for HR App + Candidate App)

---

## Local Setup

### 1. Start Infrastructure

```bash
# From project root (ai-recruitment-poc/)
docker compose up -d
```

This starts:
- **PostgreSQL 15** on port 5432
- **Redis 7** on port 6379

Health checks are configured. Wait ~15 seconds for both services to be ready.

Verify:
```bash
docker compose ps
```
Both services should show `healthy`.

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv

# Activate (Windows PowerShell)
.venv\Scripts\Activate.ps1

# Activate (macOS/Linux)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy and edit environment file
cp .env.example .env
# Edit .env — at minimum set OPENAI_API_KEY
# For free local dev without API costs, set MOCK_EXTERNAL_APIS=true (see MOCK_MODE.md)
```

### 3. Run Database Migrations

```bash
# From backend/ directory, with .venv activated
alembic upgrade head
```

This creates all application tables.

### 4. Start the API Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs available at: http://localhost:8000/docs

Health check: http://localhost:8000/health

### 5. Start Celery (separate terminals)

Recommended: use `.\start-dev.ps1` from the project root (starts worker + beat automatically).

Manual start from `backend/` with `.venv` activated:

```bash
# Worker — all queues (dev)
celery -A app.core.celery_app.celery_app worker --loglevel=info --pool=solo --queues=resume,shortlist,screening,interviews

# Beat — exactly one instance per environment
celery -A app.core.celery_app.celery_app beat --loglevel=info
```

Production queue topology and scaling: see [`backend/DEPLOY-CELERY.md`](backend/DEPLOY-CELERY.md).

Celery health: http://localhost:8000/api/health/celery

---

## Environment Variables

See `.env.example` for all required variables.

| Variable | Required By | Notes |
|----------|------------|-------|
| `MOCK_EXTERNAL_APIS` | Optional | `true` = mock OpenAI, Vapi, LiveKit, Gmail (see `MOCK_MODE.md`) |
| `DATABASE_URL` | Always | postgresql+asyncpg://... |
| `REDIS_URL` | Always | redis://localhost:6379/0 |
| `OPENAI_API_KEY` | Sprint 3+ | Resume parsing, shortlisting, assessment |
| `VAPI_API_KEY` | Sprint 5+ | Outbound call orchestration |
| `SARVAM_API_KEY` | Sprint 5+ | Indian STT/TTS via Vapi |
| `LIVEKIT_API_KEY` | Sprint 6+ | LiveKit Cloud |
| `LIVEKIT_API_SECRET` | Sprint 6+ | LiveKit Cloud |
| `LIVEKIT_URL` | Sprint 6+ | wss://your-project.livekit.cloud |
| `S3_ACCESS_KEY` | Sprint 6+ | Linode Object Storage (egress recordings) |
| `S3_SECRET_KEY` | Sprint 6+ | Linode Object Storage |
| `S3_ENDPOINT` | Sprint 6+ | e.g. `https://in-maa-1.linodeobjects.com` |
| `S3_REGION` | Sprint 6+ | e.g. `in-maa-1` |
| `S3_BUCKET` | Sprint 6+ | Bucket for interview recordings |
| `S3_FORCE_PATH_STYLE` | Sprint 6+ | `true` for Linode |
| `RESEND_API_KEY` | Sprint 6+ | Interview link emails |

---

## Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI app, CORS, error handler, router includes
│   ├── api/
│   │   └── routes/          # Route handlers (stub implementations → filled each sprint)
│   │       ├── jobs.py
│   │       ├── candidates.py
│   │       ├── shortlist.py
│   │       ├── screening.py
│   │       └── interviews.py
│   ├── models/
│   │   └── models.py        # SQLAlchemy ORM models (all 6 entities)
│   ├── schemas/
│   │   └── schemas.py       # Pydantic request/response schemas
│   ├── services/            # Business logic — filled Sprint 3+
│   ├── tasks/               # Celery tasks — filled Sprint 3+
│   └── core/
│       ├── config.py        # Pydantic Settings (env vars)
│       ├── database.py      # Async SQLAlchemy engine + get_db dependency
│       └── celery_app.py    # Celery instance
├── alembic/
│   ├── env.py               # Async Alembic env configuration
│   ├── script.py.mako       # Migration file template
│   └── versions/
│       └── 0001_initial_schema.py  # Initial tables
├── alembic.ini
├── requirements.txt
└── .env.example
```

---

## Development Notes

- **Authentication** — JWT email/password for the HR App. Roles: `admin` (Settings + Users) and `hr` (hiring pipeline + archive). Candidate App still uses UUID interview tokens.
- Set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env` to create the first admin on startup.
- Route handlers in `api/routes/` are stubbed with `501 Not Implemented`. They get filled sprint by sprint.
