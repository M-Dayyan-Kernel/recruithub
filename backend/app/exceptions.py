"""Domain exception hierarchy for Part 1 platform APIs."""

from __future__ import annotations


class DomainError(Exception):
    status_code = 500
    public_message = "internal error"
    headers: dict[str, str] | None = None
    #: Stable machine-readable tag echoed to clients so the UI can branch on a
    #: specific failure instead of string-matching the human message.
    error_code: str | None = None

    def __init__(
        self,
        message: str | None = None,
        *,
        public_message: str | None = None,
        headers: dict[str, str] | None = None,
        error_code: str | None = None,
    ) -> None:
        self.public_message = public_message or self.public_message
        super().__init__(message or self.public_message)
        if headers is not None:
            self.headers = headers
        if error_code is not None:
            self.error_code = error_code


class AuthenticationError(DomainError):
    status_code = 401
    public_message = "Not authenticated"

    def __init__(
        self,
        message: str | None = None,
        *,
        public_message: str | None = None,
        headers: dict[str, str] | None = None,
        error_code: str | None = None,
    ) -> None:
        super().__init__(
            message,
            public_message=public_message or "Not authenticated",
            headers=headers or {"WWW-Authenticate": "Bearer"},
            error_code=error_code,
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


class PayloadTooLargeError(DomainError):
    status_code = 413
    public_message = "Payload too large"


class JobDocumentFormatError(DomainError):
    status_code = 422
    public_message = "Unsupported file type"

    def __init__(self, message: str) -> None:
        self.response_content = {
            "error": "unsupported_file_type",
            "message": message,
        }
        super().__init__(message, public_message=message)


class EmptyJobDescriptionError(ValidationError):
    public_message = "No text could be extracted from the document."


class JobParseUnavailableError(ServiceUnavailableError):
    pass


class JobParseFailedError(DomainError):
    status_code = 500
    public_message = "Failed to parse job description"


class ResumeDocumentFormatError(DomainError):
    status_code = 422
    public_message = "Unsupported file type"

    def __init__(self, message: str = "Only PDF, DOCX, and ZIP files are accepted.") -> None:
        self.response_content = {
            "error": "unsupported_file_type",
            "message": message,
        }
        super().__init__(message, public_message=message)


class InvalidZipError(DomainError):
    status_code = 422
    public_message = "Invalid ZIP archive"

    def __init__(self, message: str) -> None:
        self.response_content = {
            "error": "invalid_zip",
            "message": message,
        }
        super().__init__(message, public_message=message)


class UploadDirectoryError(DomainError):
    status_code = 500
    public_message = (
        "Upload directory could not be created. Check server file permissions."
    )


class CandidateNotFoundForJobError(NotFoundError):
    public_message = "Candidate not found for this job"


class CandidateNotRetryableError(ValidationError):
    public_message = "Candidate is not in a retryable state"


class NoEligibleCandidatesError(ValidationError):
    public_message = "No eligible candidates found for shortlisting."

    def __init__(
        self,
        message: str = "No eligible candidates found for shortlisting.",
        *,
        skipped: list[dict] | None = None,
    ) -> None:
        self.skipped = skipped or []
        super().__init__(public_message=message)


class ShortlistInProgressError(ConflictError):
    public_message = "Shortlisting is already in progress for this job. Please wait."


class ShortlistUnavailableError(ServiceUnavailableError):
    public_message = "Shortlisting is temporarily unavailable. Try again shortly."


class EmptyCandidateIdsError(ValidationError):
    public_message = "candidate_ids is required and must be a non-empty list."


class ScreeningDisabledError(AuthorizationError):
    pass


class ScreeningUnavailableError(ServiceUnavailableError):
    pass


class InvalidWebhookTokenError(AuthenticationError):
    public_message = "Invalid or missing webhook token"


class InterviewCapacityError(ServiceUnavailableError):
    def __init__(self, *, retry_after_minutes: int) -> None:
        self.response_content = {
            "detail": {
                "code": "interview_capacity_full",
                "message": "All interviewers are currently busy. Please try again later.",
                "retry_after_minutes": retry_after_minutes,
            }
        }
        super().__init__(
            public_message="All interviewers are currently busy. Please try again later."
        )


class InterviewJoinWindowError(AuthorizationError):
    pass


class InvalidLiveKitWebhookError(AuthenticationError):
    public_message = "Invalid LiveKit webhook signature"
