---
name: alembic-migrations
description: >-
  Authors Alembic migrations and tenant-safe schema changes for the shared-DB
  multi-tenant FastAPI backend. Enforces models in models.py, sync Alembic URL
  (asyncpg→psycopg2), expand-then-constrain for NOT NULL columns, tenant_id /
  get_tenant_* helpers, and alembic upgrade head before relying on new schema.
  Use when adding a column/table, writing a migration, changing SQLAlchemy
  models, or touching tenancy. Do not use for pure service/API logic with no
  schema change (use fastapi-feature) or frontend-only work.
---

# Alembic migrations & multi-tenancy

Schema changes go through Alembic. Do not hand-edit production DBs or add DDL in app startup.

Canonical sources:

- Models: [`backend/app/models/models.py`](backend/app/models/models.py) (`Base.metadata`)
- Alembic env: [`backend/alembic/env.py`](backend/alembic/env.py) (sync URL via `+psycopg2`)
- Versions: [`backend/alembic/versions/`](backend/alembic/versions/)
- Tenant helpers: [`backend/app/core/tenancy.py`](backend/app/core/tenancy.py)
- Local apply: `alembic upgrade head` from `backend/` (see root `README.md`)
- Deploy: compose/runbooks always run upgrade before new API/workers

## Workflow

1. **Update the SQLAlchemy model first** in `models.py` (source of truth for autogenerate/metadata).
2. **Generate or hand-write** a revision under `alembic/versions/`. Prefer a clear revision id + message; keep `down_revision` linear (no accidental branches).
3. **Implement `upgrade` / `downgrade`** that actually reverse each other when safe.
4. **Apply locally**: `alembic upgrade head` with `.env` / DB reachable.
5. If the API contract changes, update [`INTERFACE.md`](INTERFACE.md) and callers (HR/Candidate) in the same change set when practical.

Alembic uses the **sync** driver: `env.py` rewrites `DATABASE_URL` from `+asyncpg` to `+psycopg2`. Migrations run with `NullPool`. Do not switch env.py to async without an explicit project decision.

## Safe column / table patterns

**Add nullable column** — simple `op.add_column`, then backfill in app or a follow-up if needed.

**Add NOT NULL column on existing rows** — expand then constrain:

1. Add column nullable (or with `server_default`)
2. `UPDATE` existing rows
3. `alter_column(..., nullable=False)` and drop default if it was only for migrate

See multi-tenant backfill style in `p0q1r2s3t4u5_add_multi_tenant.py` and simple add in `l6m7n8o9p0q1_add_hr_decision_to_interview_sessions.py`.

**Indexes / FKs** — name constraints explicitly when adding FKs; match existing `ix_*` / `fk_*` naming. Prefer `ondelete` consistent with related models (`CASCADE` vs `SET NULL` — never `SET NULL` on a non-nullable column).

**Drops** — confirm no code path still writes the column; prefer deploy order: ship code that stops using it, then migration that drops (or combine only when safe).

## Multi-tenancy rules

Shared database; isolation is **query-time** via `tenant_id` (and joins through `Job` for job-scoped entities).

- New **tenant-owned** tables need `tenant_id` → `tenants.id` (usually `nullable=False`, indexed, `ondelete="CASCADE"`) unless they are global/platform-only by design.
- Job-scoped rows often inherit tenancy through `job_id` → `jobs.tenant_id`. Prefer `get_tenant_job` / `get_tenant_candidate` / `get_tenant_shortlist_result` / `get_tenant_screening_call` over raw `select` by id alone.
- Router/service code must scope by `require_user_tenant(user)` (or equivalent actor tenant). A migration that adds data without tenant scope is a security bug, not just a schema nit.
- Platform/`superadmin` paths are special; do not copy their unscoped queries into tenant HR flows.

When adding a new entity type that needs tenant helpers, add a `get_tenant_*` helper in `tenancy.py` rather than scattering join filters.

## Checklist

- [ ] Model updated in `models.py`
- [ ] New revision has correct `down_revision` (single head)
- [ ] `upgrade` / `downgrade` reviewed; NOT NULL changes use expand-backfill-constrain
- [ ] Tenant-owned data has `tenant_id` or a join path through a tenant-owned parent
- [ ] App queries use tenancy helpers / tenant filters
- [ ] `alembic upgrade head` succeeds locally
- [ ] No secrets or environment-specific data hard-coded beyond intentional seed constants

## Out of scope here

Runtime Celery/session rules → `celery-workers`. New endpoint shape → `fastapi-feature`. Logging → `backend-logging`.
