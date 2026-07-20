"""Tests for CombinedShortlistOutput schema."""

from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.schemas.ai_outputs import CombinedShortlistOutput


class CombinedShortlistSchemaTests(unittest.TestCase):
    def test_valid_combined_output(self) -> None:
        data = CombinedShortlistOutput.model_validate(
            {
                "profile": {
                    "name": "Ada Lovelace",
                    "email": "ada@example.com",
                    "phone": "+1234567890",
                    "skills": ["Python"],
                    "total_experience_years": 5,
                    "experience": [{"company": "Acme", "title": "Engineer"}],
                    "education": [],
                    "current_company": "Acme",
                    "current_role": "Engineer",
                },
                "assessment": {
                    "match_score": 85,
                    "recommendation": "shortlisted",
                    "strengths": ["Strong Python"],
                    "gaps": [],
                    "reason": "Good fit",
                },
            }
        )
        self.assertEqual(data.profile.name, "Ada Lovelace")
        self.assertEqual(data.assessment.recommendation, "shortlisted")

    def test_missing_assessment_raises(self) -> None:
        with self.assertRaises(ValidationError):
            CombinedShortlistOutput.model_validate({"profile": {"skills": []}})


if __name__ == "__main__":
    unittest.main()
