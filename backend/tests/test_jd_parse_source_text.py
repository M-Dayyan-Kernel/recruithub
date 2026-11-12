"""The parsed job description carries the text read from the document, for the preview."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

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


if __name__ == "__main__":
    unittest.main()
