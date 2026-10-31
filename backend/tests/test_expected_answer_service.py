"""ExpectedAnswerService tests."""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.expected_answer_service import ExpectedAnswerService


def _job():
    job = MagicMock()
    job.title = "Engineer"
    job.description = "Build APIs"
    job.required_skills = ["Python"]
    job.seniority_level = "mid"
    return job


class ExpectedAnswerServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_blank_question_has_no_points(self):
        self.assertEqual(await ExpectedAnswerService().generate("   ", _job(), "key"), [])

    async def test_no_api_key_has_no_points(self):
        with patch("app.clients.mocks.mock_openai_enabled", return_value=False):
            self.assertEqual(await ExpectedAnswerService().generate("Explain REST", _job(), ""), [])

    async def test_points_come_from_the_model_and_are_capped(self):
        client = MagicMock()
        client.chat_completion_json = AsyncMock(
            return_value='{"expected_points": ["a", " b ", "", "c", "d", "e", "f", "g", "h"]}'
        )
        with patch("app.clients.mocks.mock_openai_enabled", return_value=False), \
             patch("app.services.expected_answer_service.openai_client", return_value=client):
            points = await ExpectedAnswerService().generate("Explain REST", _job(), "key")
        self.assertEqual(points[:3], ["a", "b", "c"])
        self.assertLessEqual(len(points), 6)  # config.parsing.expected_answer_max_points

    async def test_a_failed_call_has_no_points_rather_than_raising(self):
        client = MagicMock()
        client.chat_completion_json = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.clients.mocks.mock_openai_enabled", return_value=False), \
             patch("app.services.expected_answer_service.openai_client", return_value=client):
            self.assertEqual(await ExpectedAnswerService().generate("Explain REST", _job(), "key"), [])


if __name__ == "__main__":
    unittest.main()
