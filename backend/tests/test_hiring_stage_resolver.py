"""HiringStageResolver unit tests."""

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.services.hiring_stage_resolver import resolve_hiring_stage


def _candidate(**kwargs):
    c = MagicMock()
    c.status = kwargs.get("status", "active")
    c.pipeline_status = kwargs.get("pipeline_status", "completed")
    return c


def _shortlist(**kwargs):
    s = MagicMock()
    s.hr_decision = kwargs.get("hr_decision", "pending")
    s.finalist_at = kwargs.get("finalist_at")
    return s


def _screening(**kwargs):
    s = MagicMock()
    s.call_status = kwargs.get("call_status", "completed")
    s.result = kwargs.get("result", "pass")
    return s


def _interview_session(**kwargs):
    s = MagicMock()
    s.status = kwargs.get("status", "pending")
    return s


class HiringStageResolverTests(unittest.TestCase):
    def test_manual_hired_overrides_pipeline(self):
        stage = resolve_hiring_stage(
            _candidate(status="hired"),
            shortlist=_shortlist(),
            screening=_screening(),
        )
        self.assertEqual(stage, "Hired")

    def test_manual_rejected_overrides_pipeline(self):
        stage = resolve_hiring_stage(
            _candidate(status="rejected"),
            shortlist=_shortlist(hr_decision="approved"),
        )
        self.assertEqual(stage, "Rejected")

    def test_processing_when_queued(self):
        stage = resolve_hiring_stage(_candidate(pipeline_status="queued"))
        self.assertEqual(stage, "Processing")

    def test_failed_pipeline_status(self):
        stage = resolve_hiring_stage(_candidate(pipeline_status="failed"))
        self.assertEqual(stage, "Failed")

    def test_finalist_when_the_application_is_marked(self):
        stage = resolve_hiring_stage(
            _candidate(),
            shortlist=_shortlist(hr_decision="approved", finalist_at=datetime.now(timezone.utc)),
            screening=_screening(),
            interview_session=_interview_session(status="completed"),
            interview_report=MagicMock(),
        )
        self.assertEqual(stage, "Finalist")

    def test_a_rejection_beats_the_finalist_mark(self):
        stage = resolve_hiring_stage(
            _candidate(),
            shortlist=_shortlist(hr_decision="rejected", finalist_at=datetime.now(timezone.utc)),
            interview_session=_interview_session(status="completed"),
        )
        self.assertEqual(stage, "Rejected")

    def test_every_round_state_keeps_the_candidate_in_interview(self):
        for status in ("pending", "in_progress", "completed", "assessed", "assessment_failed", "expired", "cancelled"):
            with self.subTest(status=status):
                stage = resolve_hiring_stage(
                    _candidate(),
                    shortlist=_shortlist(hr_decision="approved"),
                    screening=_screening(),
                    interview_session=_interview_session(status=status),
                )
                self.assertEqual(stage, "Interview")

    def test_interview_in_progress(self):
        stage = resolve_hiring_stage(
            _candidate(),
            shortlist=_shortlist(),
            screening=_screening(),
            interview_session=_interview_session(status="in_progress"),
        )
        self.assertEqual(stage, "Interview")

    def test_screening_active_call(self):
        stage = resolve_hiring_stage(
            _candidate(),
            shortlist=_shortlist(),
            screening=_screening(call_status="in_progress", result=None),
        )
        self.assertEqual(stage, "Screening")

    def test_screening_fail_is_rejected(self):
        stage = resolve_hiring_stage(
            _candidate(),
            shortlist=_shortlist(),
            screening=_screening(result="fail"),
        )
        self.assertEqual(stage, "Rejected")

    def test_ai_shortlisted_when_shortlist_exists(self):
        stage = resolve_hiring_stage(
            _candidate(),
            shortlist=_shortlist(),
        )
        self.assertEqual(stage, "AI Shortlisted")

    def test_shortlist_rejected(self):
        stage = resolve_hiring_stage(
            _candidate(),
            shortlist=_shortlist(hr_decision="rejected"),
        )
        self.assertEqual(stage, "Rejected")


if __name__ == "__main__":
    unittest.main()
