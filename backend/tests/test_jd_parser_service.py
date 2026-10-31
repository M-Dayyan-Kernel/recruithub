"""JdParserService tests."""

import unittest
from unittest.mock import patch

from app.services.interview_topic_service import normalize_generated_topics
from app.services.jd_parser_service import JdParserService


def _topic(name, question="Explain how you would approach this on a real project.", **extra):
    return {"name": name, "scope": "What to probe.", "skill_tag": "Python", "seed_question": question, **extra}


class JdParserServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_short_input_returns_empty_jd(self):
        parsed = await JdParserService().parse("hi", "test-key")
        self.assertEqual(parsed["title"], "")
        self.assertEqual(parsed["interview_topics"], [])

    @patch("app.clients.mocks.mock_openai_enabled", return_value=True)
    @patch("app.clients.mocks.mock_jd_parse")
    async def test_mock_parse_keeps_only_usable_topics(self, mock_parse, _mock_enabled):
        mock_parse.return_value = {
            "title": "Engineer",
            "description": "Build things",
            "required_skills": ["Python"],
            "seniority_level": "mid",
            "screening_questions": [{"question": "Are you available?"}],
            "interview_topics": [
                _topic("REST APIs", "Explain REST APIs"),
                _topic("Conflict", "Tell me about a time you handled conflict"),
            ],
        }
        parsed = await JdParserService().parse("x" * 100, "key")
        self.assertEqual(parsed["title"], "Engineer")
        self.assertEqual(len(parsed["screening_questions"]), 1)
        self.assertEqual([t["name"] for t in parsed["interview_topics"]], ["REST APIs"])


class NormalizeGeneratedTopicsTests(unittest.TestCase):
    def test_a_coding_question_is_dropped_not_fatal(self):
        topics = normalize_generated_topics([
            _topic("Sorting", "Write a function to sort an array"),
            _topic("Indexing", "Explain database indexing"),
        ])
        self.assertEqual([t["name"] for t in topics], ["Indexing"])

    def test_repeated_names_and_malformed_items_are_dropped(self):
        topics = normalize_generated_topics([
            _topic("Caching"), _topic("caching"), "not a topic", None, _topic("", "x"),
            {"name": "No scope", "skill_tag": "x", "seed_question": "Explain this"},
        ])
        self.assertEqual([t["name"] for t in topics], ["Caching"])

    def test_generated_topics_are_never_mandatory_and_have_no_id(self):
        topic = normalize_generated_topics([_topic("Caching", is_mandatory=True)])[0]
        self.assertFalse(topic["is_mandatory"])
        self.assertNotIn("id", topic)

    def test_skill_tags_are_lowercased_and_text_is_tidied(self):
        topic = normalize_generated_topics([_topic("  Query   tuning  ")])[0]
        self.assertEqual((topic["name"], topic["skill_tag"]), ("Query tuning", "python"))

    def test_the_pool_is_capped(self):
        raw = [_topic(f"Topic {n}") for n in range(40)]
        self.assertEqual(len(normalize_generated_topics(raw)), 20)  # parsing.topic_pool.max

    def test_not_a_list_is_nothing(self):
        for raw in (None, {}, "x", 3):
            self.assertEqual(normalize_generated_topics(raw), [])


if __name__ == "__main__":
    unittest.main()
