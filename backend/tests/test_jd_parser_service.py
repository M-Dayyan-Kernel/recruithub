"""JdParserService tests."""

import unittest
from unittest.mock import patch

from app.services.jd_parser_service import JdParserService, _normalize_parsed_questions


class JdParserServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_short_input_returns_empty_jd(self):
        service = JdParserService()
        parsed = await service.parse("hi", "test-key")
        self.assertEqual(parsed["title"], "")
        self.assertEqual(parsed["interview_questions"], [])

    @patch("app.services.mock_external.mock_openai_enabled", return_value=True)
    @patch("app.services.mock_external.mock_jd_parse")
    async def test_mock_parse_normalizes_questions(self, mock_parse, _mock_enabled):
        mock_parse.return_value = {
            "title": "Engineer",
            "description": "Build things",
            "required_skills": ["Python"],
            "experience_min": 2,
            "experience_max": 5,
            "screening_questions": [{"question": "Are you available?"}],
            "interview_questions": [
                {"question": "Explain REST APIs", "score": 10},
                {"question": "Tell me about a time you handled conflict", "score": 5},
            ],
        }
        parsed = await JdParserService().parse("x" * 100, "key")
        self.assertEqual(parsed["title"], "Engineer")
        self.assertEqual(len(parsed["screening_questions"]), 1)
        self.assertEqual(len(parsed["interview_questions"]), 1)
        self.assertEqual(parsed["interview_questions"][0]["question"], "Explain REST APIs")

    def test_filters_live_coding_questions(self):
        raw = [
            {"id": "1", "question": "Write a function to sort an array", "score": 5},
            {"id": "2", "question": "Explain database indexing", "score": 5},
        ]
        normalized = _normalize_parsed_questions(raw)
        self.assertEqual(len(normalized), 1)
        self.assertIn("indexing", normalized[0]["question"])


if __name__ == "__main__":
    unittest.main()
