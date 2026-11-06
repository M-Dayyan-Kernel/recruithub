"""The candidate page's Documents: a short-lived link to the stored resume, or a clear refusal."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import NotFoundError
from app.services.candidate_directory_service import CandidateDirectoryService


def service(row):
    directory = MagicMock()
    directory.get_profile_row = AsyncMock(return_value=row)
    return CandidateDirectoryService(MagicMock(), directory_repo=directory, audit_repo=MagicMock())


def row(path="recruitment-resume-storage/abc/resume.pdf", filename="Asha_Resume.pdf"):
    return NS(candidate=NS(resume_file_path=path, original_filename=filename))


ACTOR = NS(tenant_id=uuid.uuid4())


class ResumeLinkTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_a_presigned_link_and_the_original_filename(self):
        with patch("app.services.s3_service.is_s3_object_key", return_value=True), \
             patch("app.services.s3_service.generate_presigned_get_url_async", AsyncMock(return_value="https://s3/x?sig=1")):
            out = await service(row()).get_resume_link(ACTOR, uuid.uuid4())
        self.assertEqual((out.url, out.filename), ("https://s3/x?sig=1", "Asha_Resume.pdf"))
        self.assertGreater(out.expires_in, 0)

    async def test_an_unknown_candidate_is_not_found(self):
        with self.assertRaises(NotFoundError):
            await service(None).get_resume_link(ACTOR, uuid.uuid4())

    async def test_a_candidate_with_no_stored_file_is_refused_not_linked(self):
        for path in (None, "", "uploads/local/file.pdf"):
            with self.subTest(path), patch("app.services.s3_service.is_s3_object_key", return_value=False):
                with self.assertRaises(NotFoundError):
                    await service(row(path=path)).get_resume_link(ACTOR, uuid.uuid4())

    async def test_a_link_that_could_not_be_signed_is_refused(self):
        with patch("app.services.s3_service.is_s3_object_key", return_value=True), \
             patch("app.services.s3_service.generate_presigned_get_url_async", AsyncMock(return_value=None)):
            with self.assertRaises(NotFoundError):
                await service(row()).get_resume_link(ACTOR, uuid.uuid4())


if __name__ == "__main__":
    unittest.main()
