"""The pipeline files an application under the tab of its current round."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

from app.services.interview_pipeline_service import classify_interview_tab

NOW = datetime.now(timezone.utc)


def _round(status, started=True, expires_in_days=3, **kw):
    base = dict(
        id=uuid.uuid4(), status=status, round_number=1, voided_at=None, started_at=NOW if started else None,
        completed_at=NOW, expires_at=NOW + timedelta(days=expires_in_days), transcript="x", created_at=NOW,
    )
    base.update(kw)
    return NS(**base)


class ClassifyTabTests(unittest.TestCase):
    def test_no_round_is_pending(self):
        self.assertEqual(classify_interview_tab(None), "pending")

    def test_scheduled_live_and_cancelled(self):
        self.assertEqual(classify_interview_tab(_round("pending", started=False)), "scheduled")
        self.assertEqual(classify_interview_tab(_round("cancelled", started=False)), "scheduled")
        self.assertEqual(classify_interview_tab(_round("in_progress")), "ongoing")

    def test_a_taken_round_is_completed(self):
        for status in ("completed", "assessed", "assessment_failed"):
            with self.subTest(status):
                self.assertEqual(classify_interview_tab(_round(status), has_report=True), "completed")

    def test_finalist_wins_over_the_round_state(self):
        for status in ("completed", "assessed", "assessment_failed"):
            with self.subTest(status):
                self.assertEqual(classify_interview_tab(_round(status), has_report=True, finalist=True), "finalists")

    def test_an_untaken_expired_round_is_flagged(self):
        self.assertEqual(classify_interview_tab(_round("expired", started=False)), "flagged")


if __name__ == "__main__":
    unittest.main()
