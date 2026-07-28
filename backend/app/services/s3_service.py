"""
S3-compatible object storage helpers (Linode Object Storage).

Used for:
  - LiveKit egress recording playback (presigned GET)
  - Resume uploads under recruitment-resume-storage/
  - GST documents under recruitment-gst-files/
"""

from __future__ import annotations

import logging
from functools import lru_cache
from uuid import UUID

from app.core.async_utils import run_sync
from app.core.config_loader import config

logger = logging.getLogger(__name__)

# Default URL lifetime for HR report playback
PRESIGN_EXPIRES_SECONDS = config.storage.presign_expires_seconds

RESUME_PREFIX = config.storage.prefixes.resumes
GST_PREFIX = config.storage.prefixes.gst
RECORDING_PREFIX = config.storage.prefixes.recordings


def s3_configured() -> bool:
    return bool(
        config.S3_BUCKET
        and config.S3_ACCESS_KEY
        and config.S3_SECRET_KEY
        and config.S3_ENDPOINT
    )


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


@lru_cache(maxsize=1)
def _s3_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=config.S3_ENDPOINT.rstrip("/"),
        aws_access_key_id=config.S3_ACCESS_KEY,
        aws_secret_access_key=config.S3_SECRET_KEY,
        region_name=config.S3_REGION or "us-east-1",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if config.S3_FORCE_PATH_STYLE else "auto"},
        ),
    )


def upload_bytes(
    key: str,
    data: bytes,
    *,
    content_type: str | None = None,
) -> str:
    """Upload bytes to S3 and return the object key."""
    if not s3_configured():
        raise RuntimeError("S3 storage is not configured")
    extra: dict = {}
    if content_type:
        extra["ContentType"] = content_type
    _s3_client().put_object(
        Bucket=config.S3_BUCKET,
        Key=key,
        Body=data,
        **extra,
    )
    logger.info("Uploaded s3://%s/%s (%d bytes)", config.S3_BUCKET, key, len(data))
    return key


def download_bytes(key: str) -> bytes:
    """Download an object and return its bytes."""
    if not s3_configured():
        raise RuntimeError("S3 storage is not configured")
    response = _s3_client().get_object(Bucket=config.S3_BUCKET, Key=key)
    return response["Body"].read()


def object_exists(key: str) -> bool:
    """Return True when the object key exists in the configured bucket."""
    if not key or not s3_configured():
        return False
    try:
        _s3_client().head_object(Bucket=config.S3_BUCKET, Key=key)
        return True
    except Exception:
        return False


def delete_object(key: str) -> None:
    """Best-effort delete of an object key."""
    if not key or not s3_configured():
        return
    try:
        _s3_client().delete_object(Bucket=config.S3_BUCKET, Key=key)
        logger.info("Deleted s3://%s/%s", config.S3_BUCKET, key)
    except Exception as exc:
        logger.warning("Failed to delete S3 key %s: %s", key, exc)


def delete_objects(keys: list[str] | set[str]) -> int:
    """Best-effort bulk delete. Returns number of keys requested for deletion."""
    unique = [k for k in dict.fromkeys(keys) if k]
    if not unique or not s3_configured():
        return 0
    # S3 delete_objects accepts up to 1000 keys per call
    deleted = 0
    client = _s3_client()
    for i in range(0, len(unique), 1000):
        batch = unique[i : i + 1000]
        try:
            client.delete_objects(
                Bucket=config.S3_BUCKET,
                Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True},
            )
            deleted += len(batch)
            logger.info("Deleted %d S3 objects from %s", len(batch), config.S3_BUCKET)
        except Exception as exc:
            logger.warning("Failed bulk S3 delete (%d keys): %s", len(batch), exc)
            for key in batch:
                delete_object(key)
                deleted += 1
    return deleted


def delete_stored_file(path: str | None) -> None:
    """Delete a resume/GST/recording path whether it is an S3 key or local file."""
    if not path:
        return
    if is_s3_object_key(path):
        delete_object(path)
        return
    from pathlib import Path

    try:
        Path(path).unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Failed to delete local file %s: %s", path, exc)


def generate_presigned_get_url(
    key: str,
    *,
    expires_in: int = PRESIGN_EXPIRES_SECONDS,
) -> str | None:
    """Return a time-limited GET URL for an object key, or None on failure."""
    if not key or not s3_configured():
        return None
    try:
        url = _s3_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": config.S3_BUCKET, "Key": key},
            ExpiresIn=expires_in,
        )
        return url
    except Exception as exc:
        logger.warning("Failed to presign S3 key %s: %s", key, exc)
        return None


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
    await run_sync(_s3_client().head_bucket, Bucket=config.S3_BUCKET)
