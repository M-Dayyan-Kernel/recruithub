# Deploy guide

## Architecture

| Server | Services |
|--------|----------|
| **Server 1** | Postgres, Redis, API, HR app, Candidate app, interview-agent |
| **Server 2** | Celery beat, 3× celery-resume (10,1), celery-screening (10,1), 2× celery-interviews (12,1 + 13,1) |
| **External** | Linode Object Storage (S3), LiveKit Cloud |

Copy `backend/.env.example` → `.env.production` on both servers, but strip the 16
secret values (see "Secrets management" below — they live in `seed.env`). Keep the
same non-secret values; only `DATABASE_URL` / `REDIS_URL` differ on Server 2 (see below).

**Gmail OAuth:** set `GMAIL_CREDENTIALS_JSON` and `GMAIL_TOKEN_JSON` in `seed.env` (single-line JSON, no surrounding quotes).

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

---

## Secrets management (OpenBao)

All real secrets (JWT, OpenAI, Groq, Vapi, LiveKit, S3, Gmail, Resend,
talentOS/AIC keys) live **only** in OpenBao — never in `.env.production` and
never in a developer's local `.env`. `/health/ready` reports
`"secretsSource": "openbao"` when app containers fetch them successfully.

### Where values live

| File | Content | Where |
|------|---------|-------|
| `seed.env` (gitignored, from `seed.env.example`) | the 16 secret values, openbao-**only** | both servers |
| `.env.production` (gitignored) | non-secrets only: `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `TRUSTED_HOSTS`, `APP_URL`s, `BACKEND_PUBLIC_URL`, gateway vars | both servers |
| `backend/.env` (local, gitignored) | non-secrets + `BAO_ADDR`/`BAO_TOKEN_FILE` pointing at the **deployed** OpenBao | dev machines |

The `openbao` compose service (`docker-compose.{app,worker,prod}.yml`) is the
only container that receives the secret values as env — it seeds its KV store
from `seed.env` on boot (`recruithub` namespace, plus `dev` from `DEV_*`
overrides). api/workers/interview-agent get **zero** secret env vars; they read
from OpenBao at startup via the scoped token (`BAO_ADDR` + `BAO_TOKEN_FILE`,
set in compose).

### Set up a server

```bash
cp seed.env.example seed.env        # fill in the 16 real values
# .env.production: non-secrets only (see above)
bash deploy.sh server1              # server1: also generates .bao-allowlist.conf + .bao-htpasswd
bash deploy.sh server2
```

### Rotate a secret

```bash
nano seed.env                       # change e.g. JWT_SECRET_KEY
docker compose up -d openbao        # re-seeds (idempotent)
docker compose up -d api celery-beat celery-default celery-resume-1 celery-resume-2 celery-resume-3 celery-screening celery-interviews-a celery-interviews-b interview-agent
```

Verify on the server:

```bash
curl -s -H "X-Vault-Token: $(cat .bao-keys/root.token)" \
  http://127.0.0.1:8200/v1/secret/data/recruithub/JWT_SECRET_KEY
```

### OpenBao gateway (local dev → server secrets)

Server 1 runs an nginx gateway (the `proxy` service in `docker-compose.app.yml`,
fronting the main domain, mirroring talentOS):

- `https://api.recruithub.webknot-dev.in/v1/*` → OpenBao API, **IP-restricted**
- `https://api.recruithub.webknot-dev.in/bao-token/rh.token` → scoped app token,
  **basic-auth + IP-restricted**
- everything else → the API (nginx keeps serving it after the LB is re-pointed
  to `:443`)

Server services use the docker network (`http://openbao:8200`), never this route.

**Before locals can use it (ops):**
1. Re-point the `api.recruithub.webknot-dev.in` entry from Server-1 `:8000` to `:443`.
2. Issue/refresh the cert: `certbot certonly --nginx -d api.recruithub.webknot-dev.in` (need port 80 reachable first).
3. Set in `.env.production` on Server 1, then `bash deploy.sh server1` (or the light path: regenerate `.bao-allowlist.conf`/`.bao-htpasswd` + `docker compose up -d proxy`):

```env
BAO_TOKEN_ALLOWED_IPS="<dev-public-ip-or-cidr> ..."
BAO_TOKEN_USER=<user>
BAO_TOKEN_PASS=<password>
```

When a dev's public IP changes, update `BAO_TOKEN_ALLOWED_IPS` and regenerate
(always edit `.env.production`, never `.bao-allowlist.conf` directly).

### Onboard a developer (no SSH, no secrets on their laptop)

```bash
mkdir -p ~/.recruithub
curl -u "$BAO_TOKEN_USER:$BAO_TOKEN_PASS" \
  https://api.recruithub.webknot-dev.in/bao-token/rh.token -o ~/.recruithub/rh.token
# wrong password -> 401, non-allowlisted IP -> 403
```

`backend/.env` (keep non-secrets; delete the 16 secret values):

```env
BAO_ADDR=https://api.recruithub.webknot-dev.in
BAO_TOKEN_FILE=C:\Users\<you>\.recruithub\rh.token
BAO_KV_PATH=recruithub      # or "dev" for seed.env DEV_* overrides
BAO_REQUIRED=true
```

`start-dev.ps1` (bare uvicorn/celery/agent) then injects secrets from the server
at boot. Verify: `curl http://127.0.0.1:8000/health/ready` →
`"secretsSource": "openbao"`.

### Notes / security

- The app token is read-only (policy `rh-read`: `secret/data/recruithub/*` +
  `secret/data/dev/*`), scoped, and evergreen for this demo.
- The container auto-unseals at boot from `.bao-keys/` (root-only host dir);
  admin UI via `ssh -L 8200:127.0.0.1:8200` → `http://127.0.0.1:8200/ui`.
- Never commit `seed.env`, `.env`, `.env.production`, `.bao-keys/`,
  `.bao-htpasswd`, `.bao-allowlist.conf`.
