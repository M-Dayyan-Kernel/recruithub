---
name: fastapi-feature
description: |
  Use this skill when building a NEW feature, endpoint, or service in a Python/FastAPI backend, so it lands clean and production-ready from the start rather than needing a later refactor. Enforces: one service class per responsibility with methods in execution order (e.g. an AI/ML pipeline: retrieve → parse → prompt → infer → persist), a layered layout (routers → services → repositories/clients), injected dependencies, deliberate batch handling, edge-case and error coverage, and a production checklist.

  Trigger for: "add an endpoint," "build a new service," "implement this feature in the backend," "write the API for X," "add a route that does Y" — any new backend code in a FastAPI project.

  Don't trigger for: refactoring or cleaning up EXISTING messy code (use fastapi-refactor instead), frontend work, pure debugging, or non-FastAPI frameworks unless migrating.
license: Proprietary. Do not share.
---

# Building New FastAPI Features to Production Standard

The goal is to write the feature so it never needs the refactor later. Same standards a good refactor would impose — service classes, ordered methods, clean layers, batch handling, edge cases — but applied while the code is being designed, when it's cheap. Every new endpoint or service follows the structure below by default, not as a stretch goal.

The failure mode to avoid is "make it work now, clean it up later." Later never comes, and the shortcuts calcify into the exact vibe-coded mess a refactor has to undo. Design the shape first, then fill it in.

## Design the shape before writing code

For any new feature, decide these four things and state them in a sentence or two before writing — so the user can correct the shape while it's cheap:
- **Which service owns this?** New responsibility → new service class. Extension of an existing one → add ordered methods to it. Never a loose function in a router or a `utils` dumping ground.
- **What's the pipeline?** List the steps in execution order. That ordering becomes the method order in the class.
- **What does it touch?** DB, external API, file/blob storage — each is an injected collaborator (repository/client), never reached-for.
- **Single item, batch, or both?** If batch is even plausibly coming, design the single-item path so it's trivially wrappable (see batch section) rather than retrofitting later.

## Where new code goes

Fit the feature into the layered layout. Dependencies point one direction only: **routers → services → repositories/clients**. Schemas and config are shared. Nothing lower imports anything higher (a service never imports a router).

```
app/
├── main.py                 # app, wiring, handler + lifespan registration
├── config.py               # ONE typed Settings object, reads env once at boot
├── dependencies.py         # Depends() providers: build services, inject clients
├── routers/                # HTTP only. Thin. Validate in, call service, return.
├── services/               # Business logic. One class per service, ordered methods.
├── repositories/           # DB / blob storage I/O. The only layer that knows SQL.
├── clients/                # External APIs (LLM provider, etc). Own their timeouts.
├── schemas/                # Pydantic request/response models. The boundary contract.
├── exceptions.py           # Domain exception hierarchy
└── prompts/                # Versioned prompt templates + loader
```

A new feature usually means: a schema (request/response), a service method or new service class, maybe a repository/client method, and a thin router. Add each in its layer.

- **Router stays thin.** Parse request (Pydantic), call one service method, shape response. No business logic, no SQL, no `try/except` soup — the global handler owns errors.
- **Service never imports FastAPI or SQL.** Takes injected collaborators, raises domain exceptions. This is what keeps it testable.
- **I/O lives in repositories/clients.** One place per external system, each with its own timeout and connection settings.
- **Wire it in `dependencies.py`.** Construct the service with real collaborators for `Depends`; tests override with fakes.

## The service-class pattern

Every new service is a class. The contract:

**One class per service, one responsibility.** The class name is a noun phrase that says what it does (`ResumeShortlistingService`, not `Helpers`). If you can't name it that way, the boundary is wrong — split it.

**Dependencies injected via `__init__`.** DB sessions, HTTP clients, config, loaders come in as constructor args. A service that builds its own DB connection isn't production-ready and isn't testable.

**Methods in execution order.** A single public orchestrator (e.g. `shortlist(...)`) calls the pipeline steps in sequence; the steps are the internal methods below it, in the same order they run — `retrieve` → `parse` → `load_prompt` → `run_inference` → `persist`. Reading top-to-bottom follows the pipeline. Don't alphabetize; the order *is* the documentation.

**Small public surface.** One or two public entry points; steps are implementation detail. The router calls `service.shortlist(id)`, not five methods in sequence.

**Pure logic separate from I/O.** Parsing and scoring are testable without a network. Keep "decide" apart from "fetch" and "save."

Template to follow for a new service:

```python
from __future__ import annotations

import logging
from dataclasses import dataclass

from .exceptions import ParseError, ResumeNotFoundError
from .schemas import ShortlistResult

logger = logging.getLogger(__name__)


@dataclass
class ParsedResume:
    """Pure data. No I/O, trivially constructable in a test."""
    candidate_id: str
    text: str
    skills: list[str]
    years_experience: float


class ResumeShortlistingService:
    """Scores a candidate's resume against a role. One responsibility."""

    def __init__(
        self,
        repository: "ResumeRepository",
        llm_client: "LLMClient",
        prompt_loader: "PromptLoader",
    ) -> None:
        self._repository = repository
        self._llm = llm_client
        self._prompts = prompt_loader

    # --- public entry point --------------------------------------------------
    async def shortlist(self, candidate_id: str, role_id: str) -> ShortlistResult:
        """Orchestrates the pipeline. The only method routers call."""
        raw = await self._retrieve_resume(candidate_id)
        parsed = self._parse_resume(candidate_id, raw)          # pure, sync
        prompt = self._load_prompt(role_id, parsed)             # pure, sync
        score = await self._run_inference(prompt)
        result = await self._persist_result(candidate_id, role_id, score)
        return result

    # --- pipeline steps, in the order they execute ---------------------------
    async def _retrieve_resume(self, candidate_id: str) -> bytes:
        raw = await self._repository.retrieve(candidate_id)
        if raw is None:
            raise ResumeNotFoundError(candidate_id)
        return raw

    def _parse_resume(self, candidate_id: str, raw: bytes) -> ParsedResume:
        # CPU-bound extraction. If heavy, the CALLER offloads to a thread pool
        # (see batch section) so it can't block the event loop.
        try:
            text = _extract_text(raw)
        except Exception as exc:  # narrow to the real parse errors
            raise ParseError(candidate_id, reason=str(exc)) from exc
        if not text.strip():
            raise ParseError(candidate_id, reason="empty document")
        return ParsedResume(
            candidate_id=candidate_id,
            text=text,
            skills=_extract_skills(text),
            years_experience=_extract_experience(text),
        )

    def _load_prompt(self, role_id: str, parsed: ParsedResume) -> str:
        template = self._prompts.load("shortlist", role_id)
        return template.format(
            resume=parsed.text,
            skills=", ".join(parsed.skills),
            years=parsed.years_experience,
        )

    async def _run_inference(self, prompt: str) -> float:
        response = await self._llm.complete(prompt)   # client owns the timeout
        return _score_from_response(response)

    async def _persist_result(
        self, candidate_id: str, role_id: str, score: float
    ) -> ShortlistResult:
        result = ShortlistResult(
            candidate_id=candidate_id, role_id=role_id, score=score
        )
        await self._repository.save_result(result)
        logger.info("shortlisted candidate=%s role=%s score=%.3f",
                    candidate_id, role_id, score)
        return result


# --- module-level pure helpers (no self, no I/O, unit-testable) -------------
def _extract_text(raw: bytes) -> str: ...
def _extract_skills(text: str) -> list[str]: ...
def _extract_experience(text: str) -> float: ...
def _score_from_response(response: str) -> float: ...
```

## Build batch support in, don't bolt it on

If a feature processes items, assume batch is coming and design for it. Naive batch code is where production backends fall over. The rules:

- **Bound concurrency.** Never fire N unbounded coroutines/threads at an external API or DB — you'll exhaust connections or get rate-limited into failure. Use a semaphore (async) or a fixed worker pool. Make the limit configurable.
- **Isolate failures.** One bad item in a batch of 500 must not sink the other 499. Process items independently; return a structured response saying which succeeded and which failed and why (`{id, status, result | error}` per item).
- **Preserve order or return keys.** Return results in input order, or key every result to its input id so nothing gets silently reassociated.
- **Offload true blocking work.** CPU-bound parsing (PDF extraction, heavy regex) inside an async handler blocks the event loop and stalls *every* concurrent request. Push it to a thread/process pool (`run_in_executor`, `anyio.to_thread`) or a task queue.
- **Choose sync vs. queued by duration.** Short batches complete in-request. Long ones (minutes) belong in a background task or job queue with a status endpoint — don't hold an HTTP connection open for five minutes. State which model you're using and why.

Because the single-item path is a clean `service.shortlist(id)`, the batch endpoint just wraps it:

```python
from __future__ import annotations

import asyncio
from enum import Enum

import anyio
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

router = APIRouter()

MAX_CONCURRENCY = 10          # make this configurable via Settings
MAX_BATCH_SIZE = 500          # reject oversized batches at the edge


class BatchRequest(BaseModel):
    candidate_ids: list[str] = Field(..., min_length=1, max_length=MAX_BATCH_SIZE)
    role_id: str


class ItemStatus(str, Enum):
    ok = "ok"
    failed = "failed"


class ItemResult(BaseModel):
    candidate_id: str          # every result keyed back to its input
    status: ItemStatus
    score: float | None = None
    error: str | None = None   # safe, client-facing message only


class BatchResponse(BaseModel):
    total: int
    succeeded: int
    failed: int
    results: list[ItemResult]


@router.post("/shortlist/batch", response_model=BatchResponse)
async def shortlist_batch(
    request: BatchRequest,
    service: "ResumeShortlistingService" = Depends(get_service),
) -> BatchResponse:
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

    async def process_one(candidate_id: str) -> ItemResult:
        async with semaphore:                      # cap in-flight work
            try:
                result = await service.shortlist(candidate_id, request.role_id)
                return ItemResult(
                    candidate_id=candidate_id,
                    status=ItemStatus.ok,
                    score=result.score,
                )
            except Exception as exc:               # isolate per-item failure
                return ItemResult(
                    candidate_id=candidate_id,
                    status=ItemStatus.failed,
                    error=_client_safe_message(exc),
                )

    results = await asyncio.gather(
        *(process_one(cid) for cid in request.candidate_ids)
    )
    succeeded = sum(r.status is ItemStatus.ok for r in results)
    return BatchResponse(
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
        results=list(results),
    )


# Offload CPU-bound work (call inside the service, not the route):
async def parse_off_the_event_loop(raw: bytes) -> "ParsedResume":
    return await anyio.to_thread.run_sync(_blocking_parse, raw)


def _client_safe_message(exc: Exception) -> str:
    from .exceptions import DomainError
    if isinstance(exc, DomainError):
        return exc.public_message
    return "internal error"


def _blocking_parse(raw: bytes) -> "ParsedResume": ...
def get_service() -> "ResumeShortlistingService": ...
```

## Cover edge cases as you write, not after

New code is where edge cases are cheapest to handle — you're already in the logic. For every external boundary the feature touches, decide the failure behavior up front:

- **Inputs:** missing fields, empty batch, oversized payload, wrong content-type, malformed file, duplicate ids. Validate at the edge with Pydantic; reject early with a clear 4xx.
- **External calls:** timeout, connection error, 429, 5xx, malformed body, empty result. Every network call gets a timeout and a defined failure behavior — retry with backoff where safe (idempotent reads), fail fast where not (don't double-charge/double-insert).
- **Resources:** DB connection exhausted, missing row, file not found, quota exceeded.
- **Concurrency:** same item submitted twice, partial write, race on a shared counter.

Map these to **specific status codes and a consistent error envelope**, not a bare 500. Client errors (4xx — don't retry) vs. dependency errors (502/503/504 — retryable). Never leak internal exception text or secrets; log detail server-side with a correlation id, return a clean message. Services raise domain exceptions; a global handler maps them to HTTP:

```python
from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class DomainError(Exception):
    status_code = 500
    public_message = "internal error"

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.public_message)


class ResumeNotFoundError(DomainError):
    status_code = 404
    public_message = "resume not found"

    def __init__(self, candidate_id: str) -> None:
        super().__init__(f"resume not found: {candidate_id}")


class ParseError(DomainError):
    status_code = 422
    public_message = "could not parse resume"

    def __init__(self, candidate_id: str, reason: str) -> None:
        super().__init__(f"parse failed for {candidate_id}: {reason}")


class UpstreamError(DomainError):
    """Model/DB/blob storage misbehaved. Transient — caller may retry."""
    status_code = 502
    public_message = "upstream dependency error"


def _envelope(status_code: int, message: str, correlation_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"message": message, "correlation_id": correlation_id}},
    )


def register_exception_handlers(app: FastAPI) -> None:

    @app.exception_handler(DomainError)
    async def _handle_domain(request: Request, exc: DomainError) -> JSONResponse:
        correlation_id = _correlation_id(request)
        logger.warning("domain_error id=%s type=%s detail=%s",
                       correlation_id, type(exc).__name__, str(exc))
        return _envelope(exc.status_code, exc.public_message, correlation_id)

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        correlation_id = _correlation_id(request)
        logger.exception("unhandled_error id=%s", correlation_id)  # stack -> log
        return _envelope(500, "internal error", correlation_id)    # never to client


def _correlation_id(request: Request) -> str:
    return request.headers.get("x-correlation-id") or str(uuid.uuid4())
```

Reuse the existing hierarchy — add a new `DomainError` subclass when a feature introduces a genuinely new failure mode, rather than reaching for a bare `HTTPException` in the router.

## Production checklist before the feature is "done"

A feature isn't finished when it returns 200 on the happy path. Before calling it done:
- **Config typed and centralized** — new settings go on the one `Settings` object (pydantic-settings), read once at boot, not `os.getenv` mid-function. Required fields with no default fail loudly at startup.
- **Structured logging** with correlation ids — no `print`.
- **No blocking calls on the async path** — verified.
- **Timeouts and connection limits** on every new client/pool.
- **Type hints everywhere; Pydantic at every boundary** — request in, response out.
- **Secrets never hardcoded or logged.**

New settings extend the same object:

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
    return Settings()   # read env ONCE, not per-request
```

## How to deliver a new feature

1. State the shape first: which service, what pipeline order, what it touches, single/batch — one or two sentences, before code.
2. Add each piece in its layer (schema, service, repository/client, thin router).
3. Call out the edge cases you handled and any failure behavior you chose (retry vs. fail-fast) so the user can veto it.
4. Note any new config, and anything the feature needs for production that you didn't include.

Keep prose tight. Let the structured code carry the weight; reserve commentary for decisions and trade-offs the user needs to weigh in on.
