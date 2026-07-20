"""Tests for LLM output Pydantic schemas."""

from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.schemas.ai_outputs import ParsedResumeData, ShortlistAssessment


class ParsedResumeDataTests(unittest.TestCase):
    def test_valid_minimal(self) -> None:
        data = ParsedResumeData.model_validate(
            {
                "name": "Ada Lovelace",
                "email": "ada@example.com",
                "phone": None,
                "skills": ["Python"],
                "total_experience_years": 3,
                "experience": [],
                "education": [],
                "current_company": None,
                "current_role": None,
            }
        )
        self.assertEqual(data.name, "Ada Lovelace")
        self.assertEqual(data.skills, ["Python"])

    def test_null_lists_coerced(self) -> None:
        data = ParsedResumeData.model_validate(
            {
                "skills": None,
                "experience": None,
                "education": None,
                "total_experience_years": None,
            }
        )
        self.assertEqual(data.skills, [])
        self.assertEqual(data.experience, [])
        self.assertEqual(data.education, [])
        self.assertEqual(data.total_experience_years, 0.0)

    def test_invalid_skills_type(self) -> None:
        with self.assertRaises(ValidationError):
            ParsedResumeData.model_validate({"skills": "Python"})


class ShortlistAssessmentTests(unittest.TestCase):
    def test_valid_assessment(self) -> None:
        data = ShortlistAssessment.model_validate(
            {
                "match_score": 85,
                "recommendation": "shortlisted",
                "strengths": ["Strong Python"],
                "gaps": [],
                "reason": "Good fit",
            }
        )
        self.assertEqual(data.match_score, 85.0)
        self.assertEqual(data.recommendation, "shortlisted")

    def test_score_clamped(self) -> None:
        data = ShortlistAssessment.model_validate(
            {
                "match_score": 150,
                "recommendation": "shortlisted",
            }
        )
        self.assertEqual(data.match_score, 100.0)

    def test_unknown_recommendation_becomes_review(self) -> None:
        data = ShortlistAssessment.model_validate(
            {
                "match_score": 40,
                "recommendation": "maybe",
            }
        )
        self.assertEqual(data.recommendation, "review")

    def test_missing_score_raises(self) -> None:
        with self.assertRaises(ValidationError):
            ShortlistAssessment.model_validate({"recommendation": "review"})


if __name__ == "__main__":
    unittest.main()
