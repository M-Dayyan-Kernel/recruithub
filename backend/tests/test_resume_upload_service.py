"""ResumeUploadService tests."""

import io
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import UploadFile
from starlette.datastructures import Headers

from app.models.models import User
from app.services.resume_upload_service import ResumeUploadService


class ResumeUploadServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_skips_duplicate_filename(self):
        session = AsyncMock()
        candidate_repo = MagicMock()
        documents = MagicMock()
        storage = MagicMock()
        audit = AsyncMock()
        queue = AsyncMock()
        queue.dispatch_slots = AsyncMock(return_value=0)

        documents.is_zip_file.return_value = False
        documents.validate_upload = MagicMock()
        documents.validate_resume_size = MagicMock()
        documents.is_resume_oversized.return_value = False

        existing = MagicMock()
        candidate_repo.find_by_filename = AsyncMock(return_value=existing)

        job = MagicMock()
        job.id = uuid.uuid4()
        job.title = "Engineer"

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        upload = UploadFile(
            filename="resume.pdf",
            file=io.BytesIO(b"%PDF"),
            headers=Headers({"content-type": "application/pdf"}),
        )

        service = ResumeUploadService(
            session,
            candidate_repo=candidate_repo,
            documents=documents,
            storage=storage,
            audit_service=audit,
            queue_service=queue,
        )

        with patch(
            "app.services.resume_upload_service.get_tenant_job",
            new_callable=AsyncMock,
            return_value=job,
        ):
            with patch.object(Path, "mkdir"):
                response = await service.upload(actor, job.id, [upload])

        self.assertEqual(response.created, 0)
        self.assertEqual(response.skipped, 1)
        storage.store_resume.assert_not_called()


if __name__ == "__main__":
    unittest.main()
