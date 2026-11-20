"""The parsed job description carries the text read from the document, for the preview."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

from pydantic import ValidationError as PydanticValidationError

from app.exceptions import ValidationError
from app.schemas.schemas import JD_TEXT_MAX_CHARS, JobParseTextRequest
from app.services.job_description_parse_service import SOURCE_TEXT_MAX_CHARS, JobDescriptionParseService


def service(raw_text, parsed):
    documents = MagicMock()
    documents.validate_upload = MagicMock()
    documents.validate_size = MagicMock()
    documents.extract_text = AsyncMock(return_value=raw_text)
    parser = MagicMock()
    parser.parse = AsyncMock(return_value=parsed)
    integrations = MagicMock()
    integrations.load = AsyncMock(return_value=NS(require=MagicMock(), openai_api_key="sk-test"))
    return JobDescriptionParseService(MagicMock(), document_service=documents, parser=parser, integrations_service=integrations)


async def parse(svc):
    upload = MagicMock()
    upload.filename = "jd.pdf"
    upload.read = AsyncMock(return_value=b"%PDF")
    return await svc.parse_upload(upload, uuid.uuid4())


PARSED = {"title": "Backend Engineer", "description": "Builds APIs.", "required_skills": ["Python"]}


class SourceTextTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_response_carries_the_extracted_text(self):
        out = await parse(service("Backend Engineer\nBuilds APIs.\nPython, FastAPI", PARSED))
        self.assertEqual(out.source_text, "Backend Engineer\nBuilds APIs.\nPython, FastAPI")

    async def test_a_huge_document_is_capped_not_returned_whole(self):
        out = await parse(service("x" * (SOURCE_TEXT_MAX_CHARS + 5_000), PARSED))
        self.assertEqual(len(out.source_text), SOURCE_TEXT_MAX_CHARS)

    async def test_pasted_text_is_parsed_like_an_upload(self):
        svc = service("unused", PARSED)
        out = await svc.parse_text("Backend Engineer\nBuilds APIs.\nPython, FastAPI", uuid.uuid4())
        self.assertEqual(out.title, "Backend Engineer")
        self.assertEqual(out.source_text, "Backend Engineer\nBuilds APIs.\nPython, FastAPI")
        svc._documents.extract_text.assert_not_called()
        svc._parser.parse.assert_awaited_once()

    async def test_pasted_text_with_no_title_or_description_is_rejected(self):
        with self.assertRaises(ValidationError):
            await service("unused", {"title": "", "description": ""}).parse_text("x" * 100, uuid.uuid4())


class JobParseTextRequestTests(unittest.TestCase):
    def test_text_is_trimmed(self):
        self.assertEqual(JobParseTextRequest(text="  " + "a" * 60 + "\n").text, "a" * 60)

    def test_too_short_text_is_rejected(self):
        with self.assertRaises(PydanticValidationError):
            JobParseTextRequest(text=" " * 100 + "short")

    def test_oversized_text_is_rejected(self):
        with self.assertRaises(PydanticValidationError):
            JobParseTextRequest(text="a" * (JD_TEXT_MAX_CHARS + 1))


if __name__ == "__main__":
    unittest.main()
