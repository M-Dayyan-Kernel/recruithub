"""JD document validation and text extraction."""

from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile

from app.core.async_utils import run_sync
from app.core.config_loader import config
from app.exceptions import JobDocumentFormatError, PayloadTooLargeError
from app.services.document_extractor import ALLOWED_EXTENSIONS, extract_text_from_bytes

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


class JobDocumentService:
    def __init__(self, max_bytes: int | None = None) -> None:
        self._max_bytes = max_bytes or config.uploads.jd_max_bytes

    def validate_upload(self, file: UploadFile) -> None:
        if not self._is_allowed_jd_file(file):
            raise JobDocumentFormatError("Only PDF and DOCX files are accepted.")

    def validate_size(self, content: bytes) -> None:
        if len(content) > self._max_bytes:
            raise PayloadTooLargeError(
                public_message=(
                    f"File exceeds the {self._max_bytes // (1024 * 1024)} MB size limit."
                ),
            )

    async def extract_text(self, content: bytes, filename: str) -> str:
        try:
            return await run_sync(extract_text_from_bytes, content, filename)
        except ValueError as exc:
            raise JobDocumentFormatError(str(exc)) from exc

    @staticmethod
    def _is_allowed_jd_file(file: UploadFile) -> bool:
        ct_ok = file.content_type in ALLOWED_CONTENT_TYPES
        ext_ok = Path(file.filename or "").suffix.lower() in ALLOWED_EXTENSIONS
        return ct_ok or ext_ok
