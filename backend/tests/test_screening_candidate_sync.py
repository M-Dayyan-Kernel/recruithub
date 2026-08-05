"""Candidate field sync from screening extraction."""

import unittest
from unittest.mock import MagicMock

from app.services.candidate_field_sync import prefill_candidate_compensation_from_screening


class ScreeningCandidateSyncTests(unittest.TestCase):
    def test_prefills_only_null_candidate_fields(self):
        candidate = MagicMock()
        candidate.current_ctc = None
        candidate.expected_ctc = "12 LPA"
        candidate.notice_period = None

        screening = MagicMock()
        screening.current_ctc = "10 LPA"
        screening.expected_ctc = "15 LPA"
        screening.notice_period = "30 days"

        prefill_candidate_compensation_from_screening(candidate, screening)

        self.assertEqual(candidate.current_ctc, "10 LPA")
        self.assertEqual(candidate.expected_ctc, "12 LPA")
        self.assertEqual(candidate.notice_period, "30 days")

    def test_does_not_overwrite_existing_values(self):
        candidate = MagicMock()
        candidate.current_ctc = "8 LPA"
        candidate.expected_ctc = "11 LPA"
        candidate.notice_period = "60 days"

        screening = MagicMock()
        screening.current_ctc = "10 LPA"
        screening.expected_ctc = "15 LPA"
        screening.notice_period = "30 days"

        prefill_candidate_compensation_from_screening(candidate, screening)

        self.assertEqual(candidate.current_ctc, "8 LPA")
        self.assertEqual(candidate.expected_ctc, "11 LPA")
        self.assertEqual(candidate.notice_period, "60 days")


if __name__ == "__main__":
    unittest.main()
