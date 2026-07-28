"""CombinedShortlistService tests."""

from __future__ import annotations

import unittest
import uuid
from unittest import mock

from app.prompts.combined_shortlist import PROMPT_VERSION
from app.schemas.ai_outputs import (
    CombinedShortlistOutput,
    ParsedResumeData,
    ShortlistAssessment,
)
from app.services.combined_shortlist_service import CombinedShortlistService


class _FakeShortlistResult:
    def __init__(self):
        self.job_id = uuid.uuid4()
        self.candidate_id = uuid.uuid4()
        self.match_score = 40.0
        self.recommendation = "rejected"
        self.strengths = ["old"]
        self.gaps = ["old gap"]
        self.reason = "old reason"
        self.hr_decision = "approved"
        self.hr_feedback_type = "correctly_shortlisted"
        self.hr_comments = "keep this"
        self.model_name = None
        self.prompt_version = None


class _FakeCandidate:
    def __init__(self, cand_id: uuid.UUID):
        self.id = cand_id
        self.name = "Candidate"
        self.email = "pending_abc@upload.pending"
        self.phone = None
        self.parsed_data = None


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, existing):
        self.existing = existing

    async def execute(self, _query):
        return _ScalarResult(self.existing)


class CombinedShortlistServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_upsert_preserves_hr_fields(self) -> None:
        existing = _FakeShortlistResult()
        candidate = _FakeCandidate(existing.candidate_id)
        session = _FakeSession(existing)
        combined = CombinedShortlistOutput(
            profile=ParsedResumeData(),
            assessment=ShortlistAssessment(
                match_score=90.0,
                recommendation="shortlisted",
                strengths=["new strength"],
                gaps=[],
                reason="new reason",
            ),
        )

        with mock.patch(
            "app.services.combined_shortlist_service.config.models.combined_shortlist.name",
            "gpt-test",
        ):
            record = await CombinedShortlistService()._upsert_shortlist_from_assessment(
                session,
                existing.job_id,
                candidate,
                combined,
            )

        self.assertIs(record, existing)
        self.assertEqual(record.match_score, 90.0)
        self.assertEqual(record.hr_decision, "approved")
        self.assertEqual(record.hr_comments, "keep this")
        self.assertEqual(record.model_name, "gpt-test")
        self.assertEqual(record.prompt_version, PROMPT_VERSION)

    def test_apply_profile_updates_pending_email(self):
        candidate = _FakeCandidate(uuid.uuid4())
        CombinedShortlistService._apply_profile_to_candidate(
            candidate,
            {"name": "Jane", "email": "jane@example.com", "phone": "555"},
        )
        self.assertEqual(candidate.name, "Jane")
        self.assertEqual(candidate.email, "jane@example.com")
        self.assertEqual(candidate.phone, "555")


if __name__ == "__main__":
    unittest.main()
