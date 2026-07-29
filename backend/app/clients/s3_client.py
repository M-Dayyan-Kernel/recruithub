"""S3-compatible object storage client (Linode Object Storage)."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config_loader import config

logger = logging.getLogger(__name__)


class S3Client:
    """Boto3 S3 client with lazy initialization."""

    def __init__(self) -> None:
        self._client: Any | None = None

    def reset(self) -> None:
        """Clear cached boto3 client (tests)."""
        self._client = None

    def configured(self) -> bool:
        return bool(
            config.S3_BUCKET
            and config.S3_ACCESS_KEY
            and config.S3_SECRET_KEY
            and config.S3_ENDPOINT
        )

    def _get_client(self):
        if self._client is not None:
            return self._client
        import boto3
        from botocore.config import Config

        self._client = boto3.client(
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
        return self._client

    def upload_bytes(
        self,
        key: str,
        data: bytes,
        *,
        content_type: str | None = None,
    ) -> str:
        if not self.configured():
            raise RuntimeError("S3 storage is not configured")
        extra: dict = {}
        if content_type:
            extra["ContentType"] = content_type
        self._get_client().put_object(
            Bucket=config.S3_BUCKET,
            Key=key,
            Body=data,
            **extra,
        )
        logger.info("Uploaded s3://%s/%s (%d bytes)", config.S3_BUCKET, key, len(data))
        return key

    def download_bytes(self, key: str) -> bytes:
        if not self.configured():
            raise RuntimeError("S3 storage is not configured")
        response = self._get_client().get_object(Bucket=config.S3_BUCKET, Key=key)
        return response["Body"].read()

    def object_exists(self, key: str) -> bool:
        if not key or not self.configured():
            return False
        try:
            self._get_client().head_object(Bucket=config.S3_BUCKET, Key=key)
            return True
        except Exception:
            return False

    def delete_object(self, key: str) -> None:
        if not key or not self.configured():
            return
        try:
            self._get_client().delete_object(Bucket=config.S3_BUCKET, Key=key)
            logger.info("Deleted s3://%s/%s", config.S3_BUCKET, key)
        except Exception as exc:
            logger.warning("Failed to delete S3 key %s: %s", key, exc)

    def delete_objects(self, keys: list[str] | set[str]) -> int:
        unique = [k for k in dict.fromkeys(keys) if k]
        if not unique or not self.configured():
            return 0
        deleted = 0
        client = self._get_client()
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
                    self.delete_object(key)
                    deleted += 1
        return deleted

    def generate_presigned_get_url(
        self,
        key: str,
        *,
        expires_in: int,
    ) -> str | None:
        if not key or not self.configured():
            return None
        try:
            return self._get_client().generate_presigned_url(
                "get_object",
                Params={"Bucket": config.S3_BUCKET, "Key": key},
                ExpiresIn=expires_in,
            )
        except Exception as exc:
            logger.warning("Failed to presign S3 key %s: %s", key, exc)
            return None

    def head_bucket(self) -> None:
        if not self.configured():
            raise RuntimeError("S3 storage is not configured")
        self._get_client().head_bucket(Bucket=config.S3_BUCKET)
