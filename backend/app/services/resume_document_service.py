"""Resume upload validation and ZIP extraction."""

from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile

from app.core.async_utils import run_sync
from app.core.config_loader import config
from app.exceptions import InvalidZipError, PayloadTooLargeError, ResumeDocumentFormatError
from app.services.zip_extract_service import extract_resumes_from_zip

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_EXTENSIONS = {".pdf", ".docx"}
ZIP_CONTENT_TYPES = {"application/zip", "application/x-zip-compressed"}
ZIP_EXTENSIONS = {".zip"}


class ResumeDocumentService:
    def __init__(
        self,
        *,
        resume_max_bytes: int | None = None,
        zip_max_bytes: int | None = None,
    ) -> None:
        self._resume_max_bytes = resume_max_bytes or config.uploads.resume_max_bytes
        self._zip_max_bytes = zip_max_bytes or config.uploads.zip_max_bytes

    def validate_upload(self, file: UploadFile) -> None:
        if not self._is_allowed_upload(file):
            raise ResumeDocumentFormatError(
                "Only PDF, DOCX, and ZIP files are accepted."
            )

    def validate_resume_size(self, content: bytes, filename: str) -> None:
        if len(content) > self._resume_max_bytes:
            raise PayloadTooLargeError(
                public_message=f"File '{filename}' exceeds the 20 MB size limit.",
            )

    def validate_zip_size(self, content: bytes, filename: str) -> None:
        if len(content) > self._zip_max_bytes:
            raise PayloadTooLargeError(
                public_message=(
                    f"ZIP file '{filename}' exceeds the "
                    f"{self._zip_max_bytes // (1024 * 1024)} MB size limit."
                ),
            )

    def is_zip_file(self, file: UploadFile) -> bool:
        return self._is_zip_file(file)

    def is_resume_oversized(self, content: bytes) -> bool:
        return len(content) > self._resume_max_bytes

    async def extract_zip_members(self, content: bytes) -> list[tuple[str, bytes]]:
        try:
            return await run_sync(extract_resumes_from_zip, content)
        except ValueError as exc:
            raise InvalidZipError(str(exc)) from exc

    @staticmethod
    def _is_allowed_file(file: UploadFile) -> bool:
        ct_ok = file.content_type in ALLOWED_CONTENT_TYPES
        ext_ok = Path(file.filename or "").suffix.lower() in ALLOWED_EXTENSIONS
        return ct_ok or ext_ok

    @staticmethod
    def _is_zip_file(file: UploadFile) -> bool:
        ct_ok = file.content_type in ZIP_CONTENT_TYPES
        ext_ok = Path(file.filename or "").suffix.lower() in ZIP_EXTENSIONS
        return ct_ok or ext_ok

    def _is_allowed_upload(self, file: UploadFile) -> bool:
        return self._is_allowed_file(file) or self._is_zip_file(file)
