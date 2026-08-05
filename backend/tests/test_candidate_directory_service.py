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


if __name__ == "__main__":
    unittest.main()
