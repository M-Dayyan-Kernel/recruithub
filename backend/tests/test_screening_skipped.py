"""A skipped screening is a record, not a call: recognise new and pre-marker rows."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

from app.core.screening_skipped import SKIPPED_ENDED_REASON, is_skipped_call, skip_reason
from app.schemas.schemas import ScreeningCallResponse
from app.services import interview_skip_screening_service as skip_service
from app.services.hiring_stage_resolver import resolve_hiring_stage
from app.services.screening_gate_service import BYPASS_SUMMARY_JOB
from app.services.voice_screening_service import BYPASS_SUMMARY


def _call(**kw):
    base = dict(call_status="completed", vapi_call_id=None, ended_reason=None, summary=None)
    base.update(kw)
    return NS(**base)


class IsSkippedCallTests(unittest.TestCase):
    def test_new_rows_carry_the_marker(self):
        self.assertTrue(is_skipped_call(_call(ended_reason=SKIPPED_ENDED_REASON)))

    def test_pre_marker_rows_are_recognised_by_every_writer_summary(self):
        for summary in (
            BYPASS_SUMMARY_JOB,
            BYPASS_SUMMARY,
            "Screening bypassed — voice screening disabled",
            "Moved to interview without a screening call by Asha: wanted to fast-track",
        ):
            with self.subTest(summary=summary):
                self.assertTrue(is_skipped_call(_call(summary=summary)))

    def test_a_completed_pass_without_a_vapi_id_is_not_enough(self):
        # the proctoring demo seed and test fixtures write exactly this
        self.assertFalse(is_skipped_call(_call(summary="Strong candidate, available now.")))
        self.assertFalse(is_skipped_call(_call()))

    def test_a_real_call_is_never_skipped(self):
        self.assertFalse(is_skipped_call(_call(vapi_call_id="v1", ended_reason=SKIPPED_ENDED_REASON)))
        self.assertFalse(is_skipped_call(_call(vapi_call_id="v1", summary=BYPASS_SUMMARY_JOB)))

    def test_not_completed_is_never_skipped(self):
        self.assertFalse(is_skipped_call(_call(call_status="pending", ended_reason=SKIPPED_ENDED_REASON)))

    def test_skip_reason_is_the_summary_only_for_skipped(self):
        self.assertEqual(skip_reason(_call(summary=BYPASS_SUMMARY_JOB)), BYPASS_SUMMARY_JOB)
        self.assertIsNone(skip_reason(_call(vapi_call_id="v1", summary="hello")))


class WriterAndSchemaTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_bypass_row_is_marked(self):
        db = MagicMock()
        db.flush = AsyncMock()
        call = await skip_service._new_bypass_call(
            db, candidate_id=uuid.uuid4(), job_id=uuid.uuid4(), bypass_summary="why"
        )
        self.assertEqual(call.ended_reason, SKIPPED_ENDED_REASON)
        self.assertEqual((call.call_status, call.call_outcome, call.result), ("completed", "completed", "pass"))
        self.assertIsNone(call.vapi_call_id)
        self.assertTrue(is_skipped_call(call))

    def test_response_exposes_skipped(self):
        from datetime import datetime, timezone

        base = dict(
            id=uuid.uuid4(), candidate_id=uuid.uuid4(), job_id=uuid.uuid4(),
            call_status="completed", created_at=datetime.now(timezone.utc),
        )
        self.assertTrue(ScreeningCallResponse(**base, ended_reason=SKIPPED_ENDED_REASON).skipped)
        self.assertFalse(ScreeningCallResponse(**base, vapi_call_id="v").skipped)
        self.assertIn("skipped", ScreeningCallResponse(**base).model_dump())


class ResolverOrderTests(unittest.TestCase):
    def test_rejected_shortlist_wins_over_an_interview_session(self):
        cand = NS(status="active", pipeline_status="completed")
        shortlist = NS(hr_decision="rejected")
        for status in ("pending", "in_progress", "completed", "cancelled"):
            with self.subTest(status=status):
                session = NS(status=status, hr_decision="pending")
                self.assertEqual(
                    resolve_hiring_stage(cand, shortlist=shortlist, interview_session=session), "Rejected"
                )

    def test_approved_shortlist_with_session_still_reads_interview(self):
        cand = NS(status="active", pipeline_status="completed")
        session = NS(status="pending", hr_decision="pending")
        self.assertEqual(
            resolve_hiring_stage(cand, shortlist=NS(hr_decision="approved"), interview_session=session),
            "Interview",
        )


if __name__ == "__main__":
    unittest.main()
