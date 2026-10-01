"""GST document validation and storage."""

from __future__ import annotations

import logging
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.config_loader import config
from app.exceptions import BadRequestError, UpstreamError

logger = logging.getLogger(__name__)

MAX_GST_DOC_SIZE = config.uploads.org_doc_max_bytes


class GstDocumentService:
    async def read_and_validate_pdf(self, upload: UploadFile) -> tuple[bytes, str]:
        filename = (upload.filename or "gst.pdf").strip()
        suffix = Path(filename).suffix.lower()
        if suffix != ".pdf":
            raise BadRequestError(public_message="GST document must be a PDF file")
        data = await upload.read()
        if not data:
            raise BadRequestError(public_message="GST document is empty")
        if len(data) > MAX_GST_DOC_SIZE:
            raise BadRequestError(
                public_message=f"GST document must be under {MAX_GST_DOC_SIZE // (1024 * 1024)} MB",
            )
        if not data.startswith(b"%PDF"):
            raise BadRequestError(public_message="GST document must be a valid PDF")
        return data, filename[:255]

    def persist(self, tenant_id, data: bytes) -> str:
        from app.services.s3_service import gst_object_key, s3_configured, upload_bytes

        filename = f"gst-{uuid4().hex}.pdf"
        if s3_configured():
            try:
                return upload_bytes(
                    gst_object_key(tenant_id, filename),
                    data,
                    content_type="application/pdf",
                )
            except Exception as exc:
                logger.error("Failed to upload GST document for tenant %s: %s", tenant_id, exc)
                raise UpstreamError(
                    public_message="Could not store the uploaded document in object storage.",
                ) from exc

        dest_dir = Path(config.ORG_DOCS_DIR) / str(tenant_id)
        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest_path = dest_dir / filename
            dest_path.write_bytes(data)
        except OSError as exc:
            logger.error("Failed to persist GST document for tenant %s: %s", tenant_id, exc)
            raise UpstreamError(
                public_message=(
                    "Could not store the uploaded document. Check server file permissions."
                ),
            ) from exc
        return str(dest_path)

    async def read_document_bytes(self, doc_path: str) -> bytes:
        from app.services.s3_service import download_bytes_async, is_s3_object_key

        if is_s3_object_key(doc_path):
            return await download_bytes_async(doc_path)
        path = Path(doc_path)
        if not path.is_file():
            raise FileNotFoundError(doc_path)
        return path.read_bytes()

    async def delete_document(self, doc_path: str) -> None:
        from app.core.async_utils import run_sync
        from app.services.s3_service import delete_object_async, is_s3_object_key

        if is_s3_object_key(doc_path):
            await delete_object_async(doc_path)
            return

        path = Path(doc_path)

        def _cleanup_local_gst() -> None:
            if path.is_file():
                path.unlink(missing_ok=True)
            parent = path.parent
            if parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()

        await run_sync(_cleanup_local_gst)
