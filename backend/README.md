# AI Recruitment Backend

FastAPI + Celery multi-tenant recruitment platform.

## Processes

| Process | Command |
|---------|---------|
| API | `uvicorn app.main:app --reload` |
| Celery resume worker | `./scripts/run-celery-worker.sh resume` |
| Celery screening worker | `./scripts/run-celery-worker.sh screening` |
| Celery interviews worker | `./scripts/run-celery-worker.sh interviews` |
| Celery beat | `./scripts/run-celery-beat.sh` |
| Interview agent | see `DEPLOY-INTERVIEW.md` |

## Setup

```bash
cd backend
cp .env.example .env
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload
```

## Production

Set `APP_ENV=production` and configure all required secrets (see `.env.example`).
Use `docker-compose -f ../docker-compose.prod.yml up -d` for a reference deployment.

Health endpoints:

- `GET /health/live` — liveness
- `GET /health/ready` — Postgres + Redis (+ S3 when configured)
- `GET /api/health/celery` — worker status (optional `X-Health-Key` when `INTERNAL_HEALTH_API_KEY` set)
- `GET /metrics` — Prometheus metrics

See also `DEPLOY-CELERY.md` and `DEPLOY-INTERVIEW.md`.
