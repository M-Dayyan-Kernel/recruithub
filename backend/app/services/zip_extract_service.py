"""Extract PDF/DOCX resumes from uploaded ZIP archives with zip-slip protection."""

from __future__ import annotations

import io
import logging
import zipfile
from pathlib import Path, PurePosixPath

from app.core.config import settings

logger = logging.getLogger(__name__)

RESUME_EXTENSIONS = {".pdf", ".docx", ".doc"}
NESTED_ZIP_EXTENSION = ".zip"
MAX_ZIP_NESTING_DEPTH = 5


def _normalize_zip_path(name: str) -> str:
    """Normalize ZIP member paths so nested folders work on all platforms."""
    return name.replace("\\", "/").lstrip("./")


def _is_junk_entry(name: str) -> bool:
    parts = PurePosixPath(name).parts
    if any(part in (".", "..") for part in parts):
        return True
    if any(part.startswith(".") for part in parts):
        return True
    if "__MACOSX" in parts:
        return True
    basename = PurePosixPath(name).name
    return basename.startswith("._")


def _validate_relative_path(name: str) -> None:
    pure = PurePosixPath(name)
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError(
            f"Unsafe path in ZIP archive: {name!r}. "
            "Archive rejected for security reasons."
        )


def _flatten_storage_name(relative_path: str) -> str:
    """Turn nested paths into a unique flat filename for storage/dedup."""
    return "_".join(PurePosixPath(relative_path).parts)


def _join_zip_path(prefix: str, entry_name: str) -> str:
    if not prefix:
        return entry_name
    return str(PurePosixPath(prefix) / entry_name)


class _ZipExtractState:
    def __init__(self) -> None:
        self.results: list[tuple[str, bytes]] = []
        self.total_uncompressed = 0

    def add_resume(self, relative_path: str, file_bytes: bytes) -> None:
        uncompressed = len(file_bytes)
        self.total_uncompressed += uncompressed
        if self.total_uncompressed > settings.MAX_ZIP_UNCOMPRESSED_BYTES:
            raise ValueError(
                "ZIP archive exceeds the maximum allowed uncompressed size."
            )
        if len(self.results) >= settings.MAX_RESUMES_PER_ZIP:
            raise ValueError(
                f"ZIP archive contains more than {settings.MAX_RESUMES_PER_ZIP} resume files."
            )
        self.results.append((_flatten_storage_name(relative_path), file_bytes))


def _collect_resumes_from_zip_bytes(
    content: bytes,
    path_prefix: str,
    state: _ZipExtractState,
    *,
    depth: int = 0,
) -> None:
    if depth > MAX_ZIP_NESTING_DEPTH:
        raise ValueError("ZIP archive nesting exceeds the maximum allowed depth.")

    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        if depth == 0:
            raise ValueError("The uploaded file is not a valid ZIP archive.") from exc
        logger.info("Skipping invalid nested ZIP at %s", path_prefix or "<root>")
        return

    with archive:
        for info in archive.infolist():
            if info.is_dir():
                continue

            entry_name = _normalize_zip_path(info.filename)
            if not entry_name or _is_junk_entry(entry_name):
                continue

            _validate_relative_path(entry_name)
            full_relative = _join_zip_path(path_prefix, entry_name)
            _validate_relative_path(full_relative)

            ext = Path(PurePosixPath(entry_name).name).suffix.lower()

            if ext == NESTED_ZIP_EXTENSION:
                nested_prefix = str(PurePosixPath(full_relative).with_suffix(""))
                _collect_resumes_from_zip_bytes(
                    archive.read(info),
                    nested_prefix,
                    state,
                    depth=depth + 1,
                )
                continue

            if ext not in RESUME_EXTENSIONS:
                logger.info("Skipping non-resume file in zip: %s", full_relative)
                continue

            file_bytes = archive.read(info)
            state.add_resume(full_relative, file_bytes)


def extract_resumes_from_zip(content: bytes) -> list[tuple[str, bytes]]:
    """Extract resume files from a ZIP archive, including nested folders and ZIPs.

    Returns a list of (sanitized_filename, file_bytes) pairs.
    Raises ValueError for corrupt, empty, or unsafe archives.
    """
    state = _ZipExtractState()
    _collect_resumes_from_zip_bytes(content, "", state)

    if not state.results:
        raise ValueError(
            "No PDF or DOCX resume files found in the ZIP archive."
        )

    return state.results
