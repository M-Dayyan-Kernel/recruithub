# Deploy guide

## Architecture

| Server | Services |
|--------|----------|
| **Server 1** | Postgres, Redis, API, HR app, Candidate app, interview-agent |
| **Server 2** | Celery beat, 3× celery-resume (10,1), celery-screening (10,1), 2× celery-interviews (12,1 + 13,1) |
| **External** | Linode Object Storage (S3), LiveKit Cloud |

Copy `backend/.env.example` → `.env.production` on both servers. Use the same secrets; only `DATABASE_URL` / `REDIS_URL` differ on Server 2 (see below).

**Gmail OAuth:** set `GMAIL_CREDENTIALS_JSON` and `GMAIL_TOKEN_JSON` in `.env.production` (single-line JSON, wrap in single quotes).

**Interview recordings:** LiveKit egress uploads MP4s to Linode (`S3_BUCKET`, prefix `recruitment-interview-recordings/`). In production, configure LiveKit webhooks to `{BACKEND_PUBLIC_URL}/api/livekit/webhook`. Locally, the API falls back to checking S3 when serving reports.

---

## Server 1 (app + infra)

```bash
docker compose up -d
docker compose -f docker-compose.app.yml --profile interviews up -d --build
docker compose -f docker-compose.app.yml run --rm --entrypoint alembic api upgrade head
```

**URLs (default ports):**
- HR app: http://localhost:5173
- Candidate app: http://localhost:5174
- API: http://localhost:8000

**Server 1 `.env.production`** — containers reach Postgres/Redis on the same host:

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@host.docker.internal:5433/ai_recruitment
REDIS_URL=redis://host.docker.internal:6379/0
```

Production build with public API URL:

```bash
VITE_API_URL=https://api.yourdomain.com docker compose -f docker-compose.app.yml --profile interviews up -d --build
```

Set `CORS_ORIGINS`, `HR_APP_URL`, `CANDIDATE_APP_URL`, and `BACKEND_PUBLIC_URL` to match your domains.

Open Postgres (`5433`) and Redis (`6379`) on Server 1 **only to Server 2** (private network / security group), not the public internet.

---

## Server 2 (workers)

Point at Server 1 Postgres/Redis (replace `<SERVER1_IP>`):

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@<SERVER1_IP>:5433/ai_recruitment
REDIS_URL=redis://<SERVER1_IP>:6379/0
```

Start all workers (including screening + interviews):

```bash
docker compose -f docker-compose.worker.yml --profile full up -d --build
```

Worker capacity on Server 2:

| Service | Replicas | Autoscale | Peak concurrency |
|---------|----------|-----------|------------------|
| `celery-resume-{1,2,3}` | 3 | 10,1 each | 30 |
| `celery-interviews-a` | 1 | 12,1 | 12 |
| `celery-interviews-b` | 1 | 13,1 | 13 |
| `celery-screening` | 1 | 10,1 | 10 |

Plan for **16–32 GB RAM** on Server 2 if resume and interview pools scale to peak.

Run **one** Celery beat instance only (on Server 2).

---

## Local dev (everything on one machine)

**Option A — split compose files** (same worker topology as Server 2):

```bash
docker compose -f docker-compose.yml -f docker-compose.app.yml -f docker-compose.worker.yml --profile interviews --profile full up -d --build
docker compose -f docker-compose.app.yml run --rm --entrypoint alembic api upgrade head
```

**Option B — all-in-one** (`docker-compose.prod.yml`, uses `backend/.env`):

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm --entrypoint alembic api upgrade head
```

Both run: 3× resume (10,1), 1× screening (10,1), 2× interviews (12,1 + 13,1), plus beat.

Uses `host.docker.internal` in `.env.production` for DB/Redis.

---

## Verify

```bash
curl http://localhost:8000/health/ready
curl http://localhost:8000/health/celery
```
