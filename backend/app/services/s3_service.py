"""
S3-compatible object storage helpers (Linode Object Storage).

Path/key builders live here; I/O is delegated to S3Client.
"""

from __future__ import annotations

import logging
from pathlib import Path
from uuid import UUID

from app.clients import s3_client
from app.core.async_utils import run_sync
from app.core.config_loader import config

logger = logging.getLogger(__name__)

PRESIGN_EXPIRES_SECONDS = config.storage.presign_expires_seconds

RESUME_PREFIX = config.storage.prefixes.resumes
GST_PREFIX = config.storage.prefixes.gst
RECORDING_PREFIX = config.storage.prefixes.recordings


def s3_configured() -> bool:
    return s3_client().configured()


def is_s3_object_key(path: str | None) -> bool:
    """True when path is an object key in our known bucket prefixes."""
    if not path:
        return False
    return path.startswith((RESUME_PREFIX, GST_PREFIX, RECORDING_PREFIX, "recordings/"))


def resume_object_key(tenant_id: UUID | str, job_id: UUID | str, filename: str) -> str:
    safe = filename.replace("\\", "/").split("/")[-1]
    return f"{RESUME_PREFIX}{tenant_id}/{job_id}/{safe}"


def gst_object_key(tenant_id: UUID | str, filename: str) -> str:
    safe = filename.replace("\\", "/").split("/")[-1]
    return f"{GST_PREFIX}{tenant_id}/{safe}"


def upload_bytes(
    key: str,
    data: bytes,
    *,
    content_type: str | None = None,
) -> str:
    return s3_client().upload_bytes(key, data, content_type=content_type)


def download_bytes(key: str) -> bytes:
    return s3_client().download_bytes(key)


def object_exists(key: str) -> bool:
    return s3_client().object_exists(key)


def delete_object(key: str) -> None:
    s3_client().delete_object(key)


def delete_objects(keys: list[str] | set[str]) -> int:
    return s3_client().delete_objects(keys)


def delete_stored_file(path: str | None) -> None:
    """Delete a resume/GST/recording path whether it is an S3 key or local file."""
    if not path:
        return
    if is_s3_object_key(path):
        delete_object(path)
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Failed to delete local file %s: %s", path, exc)


def generate_presigned_get_url(
    key: str,
    *,
    expires_in: int = PRESIGN_EXPIRES_SECONDS,
) -> str | None:
    return s3_client().generate_presigned_get_url(key, expires_in=expires_in)


async def upload_bytes_async(
    key: str,
    data: bytes,
    *,
    content_type: str | None = None,
) -> str:
    return await run_sync(upload_bytes, key, data, content_type=content_type)


async def download_bytes_async(key: str) -> bytes:
    return await run_sync(download_bytes, key)


async def object_exists_async(key: str) -> bool:
    return await run_sync(object_exists, key)


async def delete_object_async(key: str) -> None:
    await run_sync(delete_object, key)


async def delete_objects_async(keys: list[str] | set[str]) -> int:
    return await run_sync(delete_objects, keys)


async def delete_stored_file_async(path: str | None) -> None:
    await run_sync(delete_stored_file, path)


async def generate_presigned_get_url_async(
    key: str,
    *,
    expires_in: int = PRESIGN_EXPIRES_SECONDS,
) -> str | None:
    return await run_sync(generate_presigned_get_url, key, expires_in=expires_in)


async def head_bucket_async() -> None:
    """Raise on failure when S3 is configured."""
    await run_sync(s3_client().head_bucket)
