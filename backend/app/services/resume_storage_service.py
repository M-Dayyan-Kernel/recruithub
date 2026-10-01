"""Resume and recording storage helpers."""

from __future__ import annotations

import uuid
from pathlib import Path

from app.core.async_utils import run_sync
from app.services.s3_service import (
    delete_objects_async,
    delete_stored_file_async,
    resume_object_key,
    s3_configured,
    upload_bytes_async,
)


class ResumeStorageService:
    async def store_resume(
        self,
        tenant_id: uuid.UUID,
        job_id: uuid.UUID,
        filename: str,
        content: bytes,
        *,
        upload_dir: Path,
    ) -> str:
        filename = Path(filename).name
        if s3_configured():
            suffix = Path(filename).suffix.lower()
            content_type = (
                "application/pdf"
                if suffix == ".pdf"
                else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            )
            return await upload_bytes_async(
                resume_object_key(tenant_id, job_id, filename),
                content,
                content_type=content_type,
            )

        dest = upload_dir / filename
        await run_sync(dest.write_bytes, content)
        return str(dest)

    async def delete_resume(self, path: str | None) -> None:
        await delete_stored_file_async(path)

    async def delete_recordings(self, keys: list[str]) -> None:
        if keys:
            await delete_objects_async(keys)
