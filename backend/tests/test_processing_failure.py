"""A failed resume's reason is a safe sentence in lists, and raw only on the audited detail."""

import datetime
import unittest
import uuid

from app.schemas.schemas import CandidateDetailResponse, CandidateResponse
from app.services.processing_failure import GENERIC, summarize_processing_failure

RAW_SQL = (
    "(sqlalchemy.dialects.postgresql.asyncpg.ProgrammingError) UndefinedColumnError: "
    "column jobs.experience_min does not exist [SQL: SELECT ... FROM jobs]"
)


def _fields(**over):
    base = dict(
        id=uuid.uuid4(), job_id=uuid.uuid4(), name="Asha", email="asha@example.com",
        pipeline_status="failed", pipeline_error=RAW_SQL, created_at=datetime.datetime(2026, 11, 2),
    )
    base.update(over)
    return base


class SummarizeTests(unittest.TestCase):
    def test_known_causes_get_their_sentence(self):
        cases = {
            "UnsupportedDocumentError: scanned pdf": "could not be read",
            "FileNotFoundError: /app/uploads/x.docx": "could not be found",
            "openai.AuthenticationError: Incorrect API key provided: sk-abc": "key is missing or invalid",
            "openai.RateLimitError: You exceeded your current quota": "rate limited",
            "Job 3f2a not found": "job for this resume",
        }
        for raw, expect in cases.items():
            with self.subTest(raw):
                self.assertIn(expect, summarize_processing_failure(raw))

    def test_an_unknown_error_is_generic_and_leaks_nothing(self):
        out = summarize_processing_failure(RAW_SQL)
        self.assertEqual(out, GENERIC)
        for leaked in ("jobs", "experience_min", "SELECT", "sqlalchemy"):
            self.assertNotIn(leaked, out)

    def test_no_error_text_is_no_reason(self):
        self.assertIsNone(summarize_processing_failure(None))
        self.assertIsNone(summarize_processing_failure("   "))


class ResponseTests(unittest.TestCase):
    def test_the_list_response_carries_the_sentence_not_the_raw_text(self):
        data = CandidateResponse(**_fields()).model_dump()
        self.assertNotIn("pipeline_error", data)
        self.assertEqual(data["failure_reason"], GENERIC)

    def test_the_detail_response_still_carries_the_raw_text(self):
        data = CandidateDetailResponse(**_fields()).model_dump()
        self.assertEqual(data["pipeline_error"], RAW_SQL)

    def test_a_candidate_that_did_not_fail_has_no_reason(self):
        data = CandidateResponse(**_fields(pipeline_status="completed", pipeline_error=None)).model_dump()
        self.assertIsNone(data["failure_reason"])

    def test_failed_without_recorded_text_still_says_something(self):
        data = CandidateResponse(**_fields(pipeline_error=None)).model_dump()
        self.assertEqual(data["failure_reason"], GENERIC)


if __name__ == "__main__":
    unittest.main()
