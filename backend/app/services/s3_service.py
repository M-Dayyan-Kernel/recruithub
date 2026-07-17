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

from app.core.config import settings

logger = logging.getLogger(__name__)

# Default URL lifetime for HR report playback
PRESIGN_EXPIRES_SECONDS = 3600

RESUME_PREFIX = "recruitment-resume-storage/"
GST_PREFIX = "recruitment-gst-files/"
RECORDING_PREFIX = "recruitment-interview-recordings/"


def s3_configured() -> bool:
    return bool(
        settings.S3_BUCKET
        and settings.S3_ACCESS_KEY
        and settings.S3_SECRET_KEY
        and settings.S3_ENDPOINT
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
        endpoint_url=settings.S3_ENDPOINT.rstrip("/"),
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION or "us-east-1",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.S3_FORCE_PATH_STYLE else "auto"},
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
        Bucket=settings.S3_BUCKET,
        Key=key,
        Body=data,
        **extra,
    )
    logger.info("Uploaded s3://%s/%s (%d bytes)", settings.S3_BUCKET, key, len(data))
    return key


def download_bytes(key: str) -> bytes:
    """Download an object and return its bytes."""
    if not s3_configured():
        raise RuntimeError("S3 storage is not configured")
    response = _s3_client().get_object(Bucket=settings.S3_BUCKET, Key=key)
    return response["Body"].read()


def delete_object(key: str) -> None:
    """Best-effort delete of an object key."""
    if not key or not s3_configured():
        return
    try:
        _s3_client().delete_object(Bucket=settings.S3_BUCKET, Key=key)
        logger.info("Deleted s3://%s/%s", settings.S3_BUCKET, key)
    except Exception as exc:
        logger.warning("Failed to delete S3 key %s: %s", key, exc)


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
            Params={"Bucket": settings.S3_BUCKET, "Key": key},
            ExpiresIn=expires_in,
        )
        return url
    except Exception as exc:
        logger.warning("Failed to presign S3 key %s: %s", key, exc)
        return None
