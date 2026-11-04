"""One stage per candidate: the classification, and the search / count / page around it."""

import datetime
import unittest
import uuid
from types import SimpleNamespace as NS

from app.core.pagination import PaginationParams
from app.schemas.schemas import PIPELINE_STAGES, PipelineCandidate, ShortlistStage
from app.services.pipeline_candidates_service import classify_pipeline_stage, summarize

NOW = datetime.datetime(2026, 11, 4)


def cand(**over):
    base = dict(status="active", pipeline_status="completed", pipeline_error=None)
    base.update(over)
    return NS(**base)


def rec(decision="pending", finalist_at=None):
    return NS(hr_decision=decision, finalist_at=finalist_at)


def stage(kind, state):
    return ShortlistStage(kind=kind, state=state)


class ClassifyTests(unittest.TestCase):
    def test_before_scoring(self):
        self.assertEqual(classify_pipeline_stage(cand(pipeline_status="queued"), None, None), "processing")
        self.assertEqual(classify_pipeline_stage(cand(pipeline_status="processing"), None, None), "processing")
        self.assertEqual(classify_pipeline_stage(cand(pipeline_status="failed"), None, None), "failed")
        # Done processing but nothing scored is not a stage of its own.
        self.assertEqual(classify_pipeline_stage(cand(), None, None), "processing")

    def test_awaiting_a_decision_is_resume_screening(self):
        for decision in ("pending", "overridden"):
            with self.subTest(decision):
                self.assertEqual(classify_pipeline_stage(cand(), rec(decision), None), "resume")

    def test_rejected_wins_over_everything_else(self):
        self.assertEqual(classify_pipeline_stage(cand(), rec("rejected"), stage("interview", "live")), "rejected")
        self.assertEqual(classify_pipeline_stage(cand(status="rejected"), rec("approved"), None), "rejected")
        # even a candidate whose processing failed earlier and who was then rejected by hand
        self.assertEqual(classify_pipeline_stage(cand(status="rejected", pipeline_status="failed"), None, None), "rejected")

    def test_approved_follows_the_resolved_position(self):
        approved = rec("approved")
        self.assertEqual(classify_pipeline_stage(cand(), approved, None), "phone")
        for state in ("queued", "live", "flagged", "review"):
            with self.subTest(state):
                self.assertEqual(classify_pipeline_stage(cand(), approved, stage("screening", state)), "phone")
        # a passed call that has no interview yet is still the phone stage's to act on
        self.assertEqual(classify_pipeline_stage(cand(), approved, stage("interview", "pending")), "phone")
        for state in ("link_sent", "live", "completed", "flagged", "cancelled"):
            with self.subTest(state):
                self.assertEqual(classify_pipeline_stage(cand(), approved, stage("interview", state)), "interview")

    def test_finalists_and_hired_are_finalists_only(self):
        self.assertEqual(classify_pipeline_stage(cand(), rec("approved", finalist_at=NOW), stage("interview", "finalist")), "finalist")
        self.assertEqual(classify_pipeline_stage(cand(), rec("approved"), stage("interview", "finalist")), "finalist")
        self.assertEqual(classify_pipeline_stage(cand(status="hired"), rec("approved"), None), "finalist")


def row(name, stage_key, email=None):
    return PipelineCandidate(
        candidate_id=uuid.uuid4(), name=name, email=email, stage=stage_key, applied_at=NOW
    )


class SummarizeTests(unittest.TestCase):
    ROWS = [
        row("Asha Rao", "resume", "asha@x.com"),
        row("Bala K", "phone"),
        row("Chitra S", "phone", "chitra@x.com"),
        row("Dev P", "interview"),
        row("Esha M", "finalist"),
        row("Farid A", "rejected"),
    ]

    def page(self, **kw):
        return summarize(self.ROWS, stage=kw.get("stage"), q=kw.get("q"), pagination=PaginationParams(limit=kw.get("limit", 50), offset=kw.get("offset", 0)))

    def test_counts_cover_every_stage_even_empty_ones(self):
        out = self.page()
        self.assertEqual(set(out.counts), set(PIPELINE_STAGES))
        self.assertEqual(out.counts["phone"], 2)
        self.assertEqual(out.counts["processing"], 0)
        self.assertEqual(sum(out.counts.values()), len(self.ROWS))

    def test_a_stage_filter_changes_the_page_and_total_but_not_the_counts(self):
        out = self.page(stage="phone")
        self.assertEqual([r.name for r in out.items], ["Bala K", "Chitra S"])
        self.assertEqual(out.total, 2)
        self.assertEqual(out.counts["resume"], 1)

    def test_search_matches_name_or_email_and_narrows_the_counts(self):
        self.assertEqual([r.name for r in self.page(q="asha").items], ["Asha Rao"])
        self.assertEqual(self.page(q="chitra@").total, 1)
        narrowed = self.page(q="s", stage="phone")
        self.assertEqual((narrowed.counts["resume"], narrowed.counts["phone"], narrowed.counts["interview"]), (1, 1, 0))
        self.assertEqual(self.page(q="zzz").total, 0)

    def test_paging(self):
        out = self.page(limit=2, offset=2)
        self.assertEqual([r.name for r in out.items], ["Chitra S", "Dev P"])
        self.assertEqual(out.total, 6)



class LandingTabTests(unittest.TestCase):
    """The tab of the stage page that lists a candidate, so a screen can open right on it."""

    def tab(self, stage_key, position=None, interview_tab=None):
        from app.services.pipeline_candidates_service import landing_tab

        return landing_tab(stage_key, position, interview_tab)

    def test_resume_opens_the_results_tab(self):
        self.assertEqual(self.tab("resume"), "results")

    def test_phone_follows_the_call_state(self):
        cases = {
            "queued": "pending", "live": "pending", "scheduled": "pending", "retrying": "pending",
            "cancelled": "pending", "review": "completed", "failed": "completed",
            "pending": "completed", "flagged": "flagged",
        }
        for state, expect in cases.items():
            with self.subTest(state):
                self.assertEqual(self.tab("phone", stage("screening", state)), expect)

    def test_a_paused_phone_candidate_is_filed_under_flagged_only_when_there_is_a_reason(self):
        paused = ShortlistStage(kind="screening", state="paused", reason="No phone number on file")
        self.assertEqual(self.tab("phone", paused), "flagged")
        self.assertEqual(self.tab("phone", stage("screening", "paused")), "pending")

    def test_interview_uses_the_interviews_tab_and_files_needs_a_link_under_scheduled(self):
        for given, expect in {"scheduled": "scheduled", "ongoing": "ongoing", "completed": "completed",
                              "flagged": "flagged", "pending": "scheduled", None: "scheduled"}.items():
            with self.subTest(given):
                self.assertEqual(self.tab("interview", None, given), expect)

    def test_other_stages_have_no_tab(self):
        for key in ("processing", "failed", "finalist", "rejected"):
            self.assertIsNone(self.tab(key))


if __name__ == "__main__":
    unittest.main()
