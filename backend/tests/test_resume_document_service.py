"""ResumeDocumentService tests."""

import io
import unittest
from datetime import datetime, timezone

from fastapi import UploadFile
from starlette.datastructures import Headers

from app.exceptions import InvalidZipError, PayloadTooLargeError, ResumeDocumentFormatError
from app.services.resume_document_service import ResumeDocumentService


def _upload(filename: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(
        filename=filename,
        file=io.BytesIO(content),
        headers=Headers({"content-type": content_type}),
    )


class ResumeDocumentServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.service = ResumeDocumentService(resume_max_bytes=100, zip_max_bytes=200)

    def test_validate_upload_rejects_txt(self):
        upload = _upload("notes.txt", b"x", "text/plain")
        with self.assertRaises(ResumeDocumentFormatError) as ctx:
            self.service.validate_upload(upload)
        self.assertEqual(ctx.exception.response_content["error"], "unsupported_file_type")

    def test_validate_resume_size_raises_413(self):
        with self.assertRaises(PayloadTooLargeError) as ctx:
            self.service.validate_resume_size(b"x" * 101, "big.pdf")
        self.assertIn("20 MB", ctx.exception.public_message)

    def test_validate_zip_size_raises_413(self):
        with self.assertRaises(PayloadTooLargeError):
            self.service.validate_zip_size(b"x" * 201, "archive.zip")

    async def test_extract_zip_members_maps_value_error(self):
        with unittest.mock.patch(
            "app.services.resume_document_service.run_sync",
            side_effect=ValueError("bad zip"),
        ):
            with self.assertRaises(InvalidZipError) as ctx:
                await self.service.extract_zip_members(b"zip")
        self.assertEqual(ctx.exception.response_content["error"], "invalid_zip")

    def test_is_zip_file_by_extension(self):
        upload = _upload("resumes.zip", b"x", "application/octet-stream")
        self.assertTrue(self.service.is_zip_file(upload))


if __name__ == "__main__":
    unittest.main()
