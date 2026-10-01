"""Candidate contact normalization and dedup helpers."""

import unittest

from app.services.candidate_contact_service import normalize_email, normalize_phone


class CandidateContactNormalizeTests(unittest.TestCase):
    def test_normalize_email_lowercases_and_strips(self):
        self.assertEqual(normalize_email("  Alice@Example.COM "), "alice@example.com")

    def test_normalize_email_ignores_placeholder(self):
        self.assertIsNone(normalize_email("resume.pdf@upload.pending"))

    def test_normalize_phone_strips_non_digits(self):
        self.assertEqual(normalize_phone("+91-98765-43210"), "919876543210")

    def test_normalize_phone_rejects_short_numbers(self):
        self.assertIsNone(normalize_phone("12345"))


if __name__ == "__main__":
    unittest.main()
