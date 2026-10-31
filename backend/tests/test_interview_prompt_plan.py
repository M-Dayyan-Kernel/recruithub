"""The interview prompt runs from the interview's plan; assessment scores against it."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import patch

from app.clients import mocks
from app.prompts.interview import build_interview_structure, build_interview_system_prompt, format_plan_block
from app.services.assessment_service import _merge_rubric_scores, _normalize_rubric_questions, generate_assessment

JOB = NS(title="Backend Engineer", seniority_level="senior")


def _item(position, section, question, points, topic=None):
    return NS(position=position, section=section, question=question, points=points, topic_name=topic)


PLAN = [
    _item(0, "intro", "Introduce yourself.", 10, "Introduction"),
    _item(1, "topic", "Explain database indexing.", 45, "Indexing"),
    _item(2, "topic", "Explain caching.", 45, "Caching"),
]


class StructureTests(unittest.TestCase):
    def test_the_plan_is_listed_in_order_with_its_sections_and_points(self):
        block = format_plan_block(PLAN)
        lines = block.splitlines()
        self.assertEqual(len(lines), 3)
        self.assertTrue(lines[0].startswith("1. [Introduction] Introduce yourself."))
        self.assertIn("[Technical: Indexing] Explain database indexing.", lines[1])
        self.assertTrue(lines[2].endswith("(worth 45 points)"))

    def test_a_planned_interview_asks_every_item_in_order_and_hides_the_points(self):
        structure = build_interview_structure(JOB, plan_items=PLAN, max_follow_ups_per_topic=2)
        self.assertIn("PLAN (mandatory, ask in order)", structure)
        self.assertIn("Never reveal point values", structure)
        self.assertIn("Explain caching.", structure)
        self.assertLess(structure.index("Introduce yourself."), structure.index("Explain caching."))

    def test_a_job_without_a_plan_keeps_the_generic_outline_at_the_jobs_level(self):
        structure = build_interview_structure(JOB, plan_items=[], max_follow_ups_per_topic=2)
        self.assertIn("Ask 3-4 technical questions relevant to Backend Engineer", structure)
        self.assertIn("Senior", structure)
        self.assertNotIn("PLAN (mandatory", structure)

    def test_the_voice_rules_state_the_configured_length_and_appear_once(self):
        prompt = build_interview_system_prompt(
            candidate_name="Asha", current_role="Dev", current_company="X", experience_years=3, skills="python",
            job_title="Backend Engineer", required_skills="python", job_description="Build things",
            interview_structure=build_interview_structure(JOB, plan_items=PLAN, max_follow_ups_per_topic=2),
            max_follow_ups_per_topic=2, target_minutes=30,
        )
        self.assertIn("about 30 minutes", prompt)
        self.assertNotIn("10-15 minutes", prompt)
        self.assertEqual(prompt.count("ORAL / VOICE-ONLY INTERVIEW RULES"), 1)
        self.assertEqual(prompt.count("TECHNICAL-ONLY RULES"), 1)


RUBRIC = [
    {"id": "a", "question": "Introduce yourself.", "score": 10, "expected_points": ["role", "tools"],
     "section": "intro", "topic": "Introduction"},
    {"id": "b", "question": "Explain indexing.", "score": 90, "expected_points": ["btree", "selectivity"],
     "section": "topic", "topic": "Indexing"},
]


class AssessmentRubricTests(unittest.IsolatedAsyncioTestCase):
    def test_the_section_and_topic_survive_normalisation(self):
        normalized = _normalize_rubric_questions(RUBRIC)
        self.assertEqual([(q["section"], q["topic"]) for q in normalized], [("intro", "Introduction"), ("topic", "Indexing")])

    def test_scores_carry_their_section_and_are_computed_from_point_coverage(self):
        gpt = [
            {"id": "a", "point_coverage": [{"point": "role", "covered": True}, {"point": "tools", "covered": True}]},
            {"id": "b", "point_coverage": [{"point": "btree", "covered": True}, {"point": "selectivity", "covered": False}]},
        ]
        merged, total = _merge_rubric_scores(_normalize_rubric_questions(RUBRIC), gpt)
        self.assertEqual([m["section"] for m in merged], ["intro", "topic"])
        self.assertEqual([m["earned_score"] for m in merged], [10, 45])
        self.assertEqual(total, 55)

    async def test_an_interview_with_a_plan_is_scored_against_it(self):
        with patch("app.clients.mocks.mock_openai_enabled", return_value=True):
            report = await generate_assessment(
                "Interviewer: hi. " * 20, JOB, NS(name="Asha", parsed_data=None), "key", rubric=RUBRIC
            )
        self.assertEqual(report["assessment_mode"], "rubric")
        self.assertEqual(report["rubric_total"], 100)
        self.assertEqual([q["section"] for q in report["question_scores"]], ["intro", "topic"])

    async def test_an_interview_without_a_plan_keeps_the_legacy_scoring(self):
        with patch("app.clients.mocks.mock_openai_enabled", return_value=True):
            report = await generate_assessment(
                "Interviewer: hi. " * 20, JOB, NS(name="Asha", parsed_data=None), "key"
            )
        self.assertEqual(report["assessment_mode"], "legacy")

    async def test_a_too_short_transcript_still_lists_what_was_asked(self):
        report = await generate_assessment("hi", JOB, NS(name="Asha", parsed_data=None), "key", rubric=RUBRIC)
        self.assertEqual(report["final_recommendation"], "needs_review")
        self.assertEqual([q["topic"] for q in report["question_scores"]], ["Introduction", "Indexing"])


if __name__ == "__main__":
    unittest.main()
