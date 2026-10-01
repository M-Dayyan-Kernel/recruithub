"""ExpectedAnswerService tests."""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.expected_answer_service import ExpectedAnswerService


class ExpectedAnswerServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_reuses_existing_points_when_question_unchanged(self):
        job = MagicMock()
        job.title = "Engineer"
        job.description = "Build APIs"
        job.required_skills = ["Python"]
        job.experience_min = 2
        job.experience_max = 5

        incoming = [{"id": "q1", "question": "Explain REST", "score": 10}]
        existing = [{"id": "q1", "question": "Explain REST", "expected_points": ["stateless"]}]

        service = ExpectedAnswerService()
        with patch.object(service, "_generate_expected_points", AsyncMock()) as mock_gen:
            result = await service.enrich(incoming, existing, job, "key")
        mock_gen.assert_not_awaited()
        self.assertEqual(result[0]["expected_points"], ["stateless"])

    async def test_regenerates_when_question_changed(self):
        job = MagicMock()
        job.title = "Engineer"
        job.description = "Build APIs"
        job.required_skills = ["Python"]
        job.experience_min = 2
        job.experience_max = 5

        incoming = [{"id": "q1", "question": "Explain GraphQL", "score": 10}]
        existing = [{"id": "q1", "question": "Explain REST", "expected_points": ["stateless"]}]

        service = ExpectedAnswerService()
        with patch.object(
            service,
            "_generate_expected_points",
            AsyncMock(return_value=["schema", "resolvers"]),
        ) as mock_gen:
            result = await service.enrich(incoming, existing, job, "key")
        mock_gen.assert_awaited_once()
        self.assertEqual(result[0]["expected_points"], ["schema", "resolvers"])


if __name__ == "__main__":
    unittest.main()
