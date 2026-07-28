"""Domain exception hierarchy for Part 1 platform APIs."""

from __future__ import annotations


class DomainError(Exception):
    status_code = 500
    public_message = "internal error"
    headers: dict[str, str] | None = None

    def __init__(
        self,
        message: str | None = None,
        *,
        public_message: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.public_message = public_message or self.public_message
        super().__init__(message or self.public_message)
        if headers is not None:
            self.headers = headers


class AuthenticationError(DomainError):
    status_code = 401
    public_message = "Not authenticated"

    def __init__(
        self,
        message: str | None = None,
        *,
        public_message: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            message,
            public_message=public_message or "Not authenticated",
            headers=headers or {"WWW-Authenticate": "Bearer"},
        )


class AuthorizationError(DomainError):
    status_code = 403
    public_message = "Insufficient permissions"


class NotFoundError(DomainError):
    status_code = 404
    public_message = "Not found"


class ConflictError(DomainError):
    status_code = 409
    public_message = "Conflict"


class ValidationError(DomainError):
    status_code = 422
    public_message = "Validation error"


class BadRequestError(DomainError):
    status_code = 400
    public_message = "Bad request"


class UpstreamError(DomainError):
    status_code = 502
    public_message = "upstream dependency error"


class ServiceUnavailableError(DomainError):
    status_code = 503
    public_message = "Service unavailable"
