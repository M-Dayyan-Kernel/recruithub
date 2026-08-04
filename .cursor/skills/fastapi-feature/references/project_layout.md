# Target project layout

Layers, not a pile of files. Dependencies point one direction only:
**routers → services → repositories/clients**. Schemas and config are shared.
Nothing lower imports anything higher (a service never imports a router).

```
app/
├── main.py                 # FastAPI app, wiring, handler + lifespan registration
├── config.py               # ONE typed Settings object, reads env once at boot
├── dependencies.py         # Depends() providers: build services, inject clients
├── routers/                # HTTP only. Thin. Validate in, call service, return.
│   └── shortlisting.py     #   def endpoint(...): return await service.shortlist(...)
├── services/               # Business logic. One class per service, ordered methods.
│   └── resume_shortlisting.py
├── repositories/           # DB / blob storage I/O. The only layer that knows SQL.
│   └── resume_repository.py
├── clients/                # External APIs (LLM provider, etc). Own their timeouts.
│   └── llm_client.py
├── schemas/                # Pydantic request/response models. The boundary contract.
│   └── shortlisting.py
├── exceptions.py           # Domain exception hierarchy (see error_handling.py)
└── prompts/                # Versioned prompt templates + loader
```

## The rules that keep it clean

- **Routers are thin.** Parse request (Pydantic), call one service method, shape
  response. No business logic, no SQL, no `try/except` soup — the global handler
  owns errors. If a router is doing work, that work belongs in a service.
- **Services never import FastAPI or SQL.** They take injected collaborators and
  raise domain exceptions. This is what makes them unit-testable and portable.
- **Repositories/clients own all I/O.** One place per external system, each with
  its own timeout and connection settings. Swap them in tests with fakes.
- **`dependencies.py` is the wiring.** It constructs services with their real
  collaborators for `Depends`. Tests override these providers with fakes — this
  is why nothing constructs its own DB connection.

## Where a new feature's code lands

A new feature is usually one new file per layer it touches, not one big file:
- a request/response model in `schemas/`
- a service class in `services/` (or new methods on an existing service)
- a repository/client in `repositories/` or `clients/` if it hits a new I/O system
- a router in `routers/` wired into `main.py`
- a `Depends` provider in `dependencies.py`
- new domain exceptions in `exceptions.py` if it has new failure modes

If a feature only needs *some* of these, that's fine — but each piece goes in its
layer, never collapsed into the router for convenience.

## Centralized config (config.py)

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    llm_api_key: str                    # required — app fails at boot if missing
    llm_timeout_seconds: float = 30.0
    db_url: str
    max_batch_size: int = 500
    max_concurrency: int = 10
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()   # read env ONCE, not per-request, not mid-function
```

Required fields with no default make missing config a **loud boot failure**, not
a mysterious 500 at 3am. Never `os.getenv` scattered through the codebase.
Never a hardcoded key. Secrets come from env, never logged. A new feature that
needs new config adds a typed field here — with a default if optional, or
required if the app can't run without it.
