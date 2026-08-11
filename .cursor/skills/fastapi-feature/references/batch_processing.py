"""
Reference: batch endpoint that does the four things naive batch code skips.

  1. Bounds concurrency        -> semaphore, so we don't exhaust the pool / get
                                  rate-limited into total failure.
  2. Isolates per-item failure -> one bad item never sinks the batch.
  3. Keys results to input ids -> nothing gets silently reassociated.
  4. Offloads blocking work    -> CPU-bound steps go to a thread pool so they
                                  don't stall the event loop for every request.

Decision rule: short batches complete in-request (below). Batches that run for
minutes belong behind a job queue with a status endpoint — don't hold an HTTP
connection open that long.
"""

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
        async with semaphore:                      # bound #2: cap in-flight work
            try:
                # If shortlist() contains CPU-bound parsing, run the blocking
                # part off the event loop. Shown here at the call boundary:
                result = await service.shortlist(candidate_id, request.role_id)
                return ItemResult(
                    candidate_id=candidate_id,
                    status=ItemStatus.ok,
                    score=result.score,
                )
            except Exception as exc:               # bound #1: isolate failure
                # Log full detail server-side; return a clean message.
                return ItemResult(
                    candidate_id=candidate_id,
                    status=ItemStatus.failed,
                    error=_client_safe_message(exc),
                )

    # gather preserves input order; each task already carries its id anyway.
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


# --- offloading CPU-bound work (call inside the service, not the route) -----
async def parse_off_the_event_loop(raw: bytes) -> "ParsedResume":
    """Wrap blocking parse work so it can't stall concurrent requests."""
    return await anyio.to_thread.run_sync(_blocking_parse, raw)
    # asyncio equivalent:
    # loop = asyncio.get_running_loop()
    # return await loop.run_in_executor(None, _blocking_parse, raw)


def _client_safe_message(exc: Exception) -> str:
    """Never leak internals. Map known types; generic message otherwise."""
    from .exceptions import DomainError
    if isinstance(exc, DomainError):
        return exc.public_message
    return "internal error"


def _blocking_parse(raw: bytes) -> "ParsedResume": ...
def get_service() -> "ResumeShortlistingService": ...
