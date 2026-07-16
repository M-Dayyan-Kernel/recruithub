"""
S3-compatible object storage helpers (Linode Object Storage).

Used to generate time-limited download URLs for LiveKit egress recordings.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from app.core.config import settings

logger = logging.getLogger(__name__)

# Default URL lifetime for HR report playback
PRESIGN_EXPIRES_SECONDS = 3600


def s3_configured() -> bool:
    return bool(
        settings.S3_BUCKET
        and settings.S3_ACCESS_KEY
        and settings.S3_SECRET_KEY
        and settings.S3_ENDPOINT
    )


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
