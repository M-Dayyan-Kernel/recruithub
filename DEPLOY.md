# Production deploy (2 servers)

**Server 1:** API + HR app + Candidate app (+ interview agent if needed)  
**Server 2:** Celery Beat + workers  
**Managed:** Postgres, Redis, S3

Copy `backend/.env.example` → `.env.production` on both servers (same file).

## Server 1

```bash
docker compose up -d   # local Postgres + Redis (if not using cloud)
docker compose -f docker-compose.app.yml up -d --build
docker compose -f docker-compose.app.yml run --rm --entrypoint alembic api upgrade head
```

- HR app: http://localhost:5173  
- Candidate app: http://localhost:5174  
- API: http://localhost:8000  

Production: set build arg `VITE_API_URL=https://api.yourdomain.com` and match `CORS_ORIGINS`, `HR_APP_URL`, `CANDIDATE_APP_URL` in `.env.production`.

```bash
VITE_API_URL=https://api.yourdomain.com docker compose -f docker-compose.app.yml up -d --build
```

Interviews only:
```bash
docker compose -f docker-compose.app.yml --profile interviews up -d --build interview-agent
```

## Server 2

```bash
docker compose -f docker-compose.worker.yml up -d --build celery-beat celery-resume
```

## Verify

```bash
curl http://localhost:8000/health/ready
curl http://localhost:8000/health/celery
```

Run **one** Beat instance only (on Server 2).
