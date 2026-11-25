"""CandidateDirectoryService unit tests."""

import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.core.pagination import PaginationParams
from app.models.models import User
from app.repositories.candidate_directory_repository import CandidateDirectoryRow
from app.services.candidate_directory_service import CandidateDirectoryService


class CandidateDirectoryServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_maps_rows_to_list_items(self):
        tenant_id = uuid.uuid4()
        job_id = uuid.uuid4()
        candidate_id = uuid.uuid4()

        candidate = MagicMock()
        candidate.id = candidate_id
        candidate.job_id = job_id
        candidate.name = "Alice"
        candidate.email = "alice@example.com"
        candidate.phone = "+91-9876543210"
        candidate.years_experience = 5.0
        candidate.current_ctc = None
        candidate.expected_ctc = None
        candidate.notice_period = None
        candidate.last_working_day = None
        candidate.status = "active"
        candidate.pipeline_status = "completed"
        candidate.created_at = datetime.now(timezone.utc)

        shortlist = MagicMock()
        shortlist.match_score = 88.0
        shortlist.hr_decision = "pending"
        shortlist.finalist_at = None

        profile_row = CandidateDirectoryRow(
            candidate=candidate,
            job_title="Frontend Engineer",
            shortlist=shortlist,
            screening=None,
            interview_session=None,
            interview_report=None,
        )

        directory_repo = MagicMock()
        directory_repo.list_for_tenant = AsyncMock(
            return_value=[(candidate, "Frontend Engineer")]
        )
        directory_repo.count_for_tenant = AsyncMock(return_value=1)
        directory_repo.get_profile_row = AsyncMock(return_value=profile_row)

        actor = User(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = CandidateDirectoryService(AsyncMock(), directory_repo=directory_repo)
        result = await service.list(
            actor,
            job_id=job_id,
            q="alice",
            pagination=PaginationParams(limit=25, offset=0),
        )

        self.assertEqual(result.total, 1)
        self.assertEqual(len(result.items), 1)
        item = result.items[0]
        self.assertEqual(item.name, "Alice")
        self.assertEqual(item.job_title, "Frontend Engineer")
        self.assertEqual(item.hiring_stage, "AI Shortlisted")
        directory_repo.list_for_tenant.assert_awaited_once()
        directory_repo.count_for_tenant.assert_awaited_once()

    async def test_list_filters_by_stage(self):
        tenant_id = uuid.uuid4()
        candidate_id = uuid.uuid4()

        candidate = MagicMock()
        candidate.id = candidate_id
        candidate.job_id = uuid.uuid4()
        candidate.name = "Alice"
        candidate.email = "alice@example.com"
        candidate.phone = None
        candidate.years_experience = None
        candidate.current_ctc = None
        candidate.expected_ctc = None
        candidate.notice_period = None
        candidate.last_working_day = None
        candidate.status = "active"
        candidate.pipeline_status = "completed"
        candidate.created_at = datetime.now(timezone.utc)

        shortlist = MagicMock()
        shortlist.match_score = 88.0
        shortlist.hr_decision = "pending"
        shortlist.finalist_at = None

        profile_row = CandidateDirectoryRow(
            candidate=candidate,
            job_title="Frontend Engineer",
            shortlist=shortlist,
            screening=None,
            interview_session=None,
            interview_report=None,
        )

        directory_repo = MagicMock()
        directory_repo.list_all_for_tenant = AsyncMock(
            return_value=[(candidate, "Frontend Engineer")]
        )
        directory_repo.get_profile_row = AsyncMock(return_value=profile_row)

        actor = User(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = CandidateDirectoryService(AsyncMock(), directory_repo=directory_repo)
        result = await service.list(
            actor,
            stage="ai_shortlisted",
            pagination=PaginationParams(limit=25, offset=0),
        )

        self.assertEqual(result.total, 1)
        self.assertEqual(result.items[0].hiring_stage, "AI Shortlisted")
        directory_repo.list_all_for_tenant.assert_awaited_once()


def _compiled(q: str) -> tuple[str, dict]:
    from sqlalchemy.dialects import postgresql

    from app.repositories.candidate_directory_repository import search_clause

    c = search_clause(q).compile(dialect=postgresql.dialect())
    return str(c), c.params


class SearchClauseTests(unittest.TestCase):
    def test_a_name_search_covers_name_and_email_but_not_phone(self):
        sql, params = _compiled("asha")
        self.assertIn("candidates.name", sql)
        self.assertIn("candidates.email", sql)
        self.assertNotIn("regexp_replace", sql)
        self.assertIn("%asha%", params.values())

    def test_an_email_search_keeps_the_at_sign(self):
        _, params = _compiled("asha@example.com")
        self.assertIn("%asha@example.com%", params.values())

    def test_a_phone_search_compares_digits_only(self):
        sql, params = _compiled("+91 98765-43210")
        self.assertIn("regexp_replace", sql)
        self.assertIn("%919876543210%", params.values())

    def test_too_few_digits_is_not_a_phone_search(self):
        sql, _ = _compiled("12")
        self.assertNotIn("regexp_replace", sql)

    def test_letters_mixed_with_digits_is_not_a_phone_search(self):
        sql, _ = _compiled("asha 98765")
        self.assertNotIn("regexp_replace", sql)

    def test_like_wildcards_are_literal(self):
        _, params = _compiled("50%_off")
        self.assertIn("%50\\%\\_off%", params.values())

    def test_the_placeholder_address_is_excluded_from_email_matching(self):
        sql, params = _compiled("pending")
        self.assertIn("NOT", sql)
        self.assertIn("%@upload.pending", params.values())


class StageFilterTests(unittest.TestCase):
    def test_every_stage_the_list_can_show_is_filterable(self):
        from app.services.candidate_stage_filter import STAGE_FILTER_TO_LABEL

        self.assertEqual(
            set(STAGE_FILTER_TO_LABEL.values()),
            {"AI Shortlisted", "Screening", "Interview", "Finalist",
             "Processing", "Failed", "Rejected", "Hired"},
        )


class PlaceholderEmailTests(unittest.TestCase):
    def _row(self, email):
        c = MagicMock()
        c.id, c.job_id, c.name, c.email, c.phone = uuid.uuid4(), uuid.uuid4(), "Asha", email, None
        c.years_experience = c.current_ctc = c.expected_ctc = c.notice_period = None
        c.last_working_day = None
        c.status, c.pipeline_status = "active", "failed"
        c.created_at = datetime.now(timezone.utc)
        return CandidateDirectoryRow(c, "Job", None, None, None, None)

    def test_the_list_never_shows_the_stand_in_address(self):
        svc = CandidateDirectoryService(AsyncMock(), directory_repo=MagicMock())
        item = svc._build_list_item(self._row("pending_8a38@upload.pending"), "Job")
        self.assertIsNone(item.email)

    def test_a_real_address_is_kept_and_the_profile_keeps_the_raw_value(self):
        svc = CandidateDirectoryService(AsyncMock(), directory_repo=MagicMock())
        self.assertEqual(svc._build_list_item(self._row("a@x.com"), "Job").email, "a@x.com")
        raw = svc._build_list_item(
            self._row("pending_1@upload.pending"), "Job", mask_placeholder_email=False
        )
        self.assertEqual(raw.email, "pending_1@upload.pending")


if __name__ == "__main__":
    unittest.main()
