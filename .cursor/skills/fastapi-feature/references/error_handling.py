"""
Reference: domain exceptions + global handlers + one error envelope.

Principle: services raise MEANING (ResumeNotFoundError), not HTTP. A thin
handler layer maps domain errors to status codes and a consistent envelope, so
business logic never imports FastAPI and every error looks the same to callers.

  - Client errors (their fault, don't retry)      -> 4xx
  - Dependency/transient errors (retry may work)  -> 502 / 503 / 504
  - Never leak stack traces or secrets. Log detail server-side, return a clean
    message + correlation id.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


# --- domain exception hierarchy ---------------------------------------------
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


# --- one error envelope ------------------------------------------------------
def _envelope(status_code: int, message: str, correlation_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "message": message,          # safe, client-facing only
                "correlation_id": correlation_id,
            }
        },
    )


# --- handlers registered once at app startup --------------------------------
def register_exception_handlers(app: FastAPI) -> None:

    @app.exception_handler(DomainError)
    async def _handle_domain(request: Request, exc: DomainError) -> JSONResponse:
        correlation_id = _correlation_id(request)
        # Full internal detail to the log; public message to the client.
        logger.warning(
            "domain_error id=%s type=%s detail=%s",
            correlation_id, type(exc).__name__, str(exc),
        )
        return _envelope(exc.status_code, exc.public_message, correlation_id)

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        correlation_id = _correlation_id(request)
        logger.exception("unhandled_error id=%s", correlation_id)  # stack -> log
        return _envelope(500, "internal error", correlation_id)    # never to client


def _correlation_id(request: Request) -> str:
    return request.headers.get("x-correlation-id") or str(uuid.uuid4())
