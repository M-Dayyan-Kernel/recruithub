"""Tests for force re-score preserving HR decision fields."""

from __future__ import annotations

import unittest
import uuid
from unittest import mock

from app.services import shortlist_service


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


class ForceRescoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_upsert_preserves_hr_fields(self) -> None:
        existing = _FakeShortlistResult()
        candidate = _FakeCandidate(existing.candidate_id)
        session = _FakeSession(existing)

        with mock.patch.object(shortlist_service.config.models.shortlist, "name", "gpt-test"):
            record = await shortlist_service._upsert_shortlist_result(
                session,
                existing.job_id,
                candidate,
                match_score=90.0,
                recommendation="shortlisted",
                strengths=["new strength"],
                gaps=[],
                reason="new reason",
            )

        self.assertIs(record, existing)
        self.assertEqual(record.match_score, 90.0)
        self.assertEqual(record.recommendation, "shortlisted")
        self.assertEqual(record.strengths, ["new strength"])
        self.assertEqual(record.reason, "new reason")
        self.assertEqual(record.hr_decision, "approved")
        self.assertEqual(record.hr_feedback_type, "correctly_shortlisted")
        self.assertEqual(record.hr_comments, "keep this")
        self.assertEqual(record.model_name, "gpt-test")
        self.assertEqual(record.prompt_version, shortlist_service.PROMPT_VERSION)


if __name__ == "__main__":
    unittest.main()
