"""Extended CandidateUpdate field coverage."""

import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.models.models import User
from app.schemas.schemas import CandidateUpdate
from app.services.candidate_service import CandidateService


class CandidateUpdateExtendedTests(unittest.IsolatedAsyncioTestCase):
    async def test_update_applies_compensation_and_status_fields(self):
        session = AsyncMock()
        audit = AsyncMock()
        candidate_repo = MagicMock()
        candidate_repo.refresh = AsyncMock()

        candidate = MagicMock()
        candidate.id = uuid.uuid4()
        candidate.job_id = uuid.uuid4()
        candidate.name = "Alice"
        candidate.email = "alice@example.com"
        candidate.phone = None
        candidate.original_filename = "resume.pdf"
        candidate.pipeline_status = "completed"
        candidate.status = "active"
        candidate.years_experience = None
        candidate.current_ctc = None
        candidate.expected_ctc = None
        candidate.notice_period = None
        candidate.last_working_day = None
        candidate.created_at = datetime.now(timezone.utc)

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = CandidateService(session, candidate_repo=candidate_repo, audit_service=audit)

        with unittest.mock.patch(
            "app.services.candidate_service.get_tenant_candidate",
            new_callable=AsyncMock,
            return_value=candidate,
        ):
            await service.update(
                actor,
                candidate.id,
                CandidateUpdate(
                    status="hired",
                    years_experience=4.5,
                    current_ctc="12 LPA",
                    expected_ctc="16 LPA",
                    notice_period="30 days",
                ),
            )

        self.assertEqual(candidate.status, "hired")
        self.assertEqual(candidate.years_experience, 4.5)
        self.assertEqual(candidate.current_ctc, "12 LPA")
        self.assertEqual(candidate.expected_ctc, "16 LPA")
        self.assertEqual(candidate.notice_period, "30 days")
        audit.log_field_changes.assert_awaited_once()

    async def test_on_hold_is_retired_and_read_as_active(self):
        self.assertEqual(CandidateUpdate(status="on_hold").status, "active")

    async def test_status_rejected_is_carried_out_as_a_rejection_not_a_label(self):
        session = AsyncMock()
        audit = AsyncMock()
        candidate = MagicMock()
        candidate.id = uuid.uuid4()
        candidate.job_id = uuid.uuid4()
        candidate.name = "Alice"
        candidate.email = "alice@example.com"
        candidate.phone = None
        candidate.status = "active"
        candidate.original_filename = "r.pdf"
        candidate.pipeline_status = "completed"
        candidate.years_experience = None
        candidate.current_ctc = None
        candidate.expected_ctc = None
        candidate.notice_period = None
        candidate.last_working_day = None
        candidate.created_at = datetime.now(timezone.utc)
        candidate_repo = MagicMock()
        candidate_repo.refresh = AsyncMock()
        actor = User(id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com", full_name="HR",
                     hashed_password="x", role="hr", is_active=True)
        service = CandidateService(session, candidate_repo=candidate_repo, audit_service=audit)
        with unittest.mock.patch(
            "app.services.candidate_service.get_tenant_candidate", new_callable=AsyncMock, return_value=candidate
        ), unittest.mock.patch(
            "app.services.reject_service.RejectService.reject", new_callable=AsyncMock
        ) as reject:
            await service.update(actor, candidate.id, CandidateUpdate(status="rejected"))
        reject.assert_awaited_once_with(actor, candidate.job_id, candidate.id)
        self.assertEqual(candidate.status, "active")  # the label is not written


if __name__ == "__main__":
    unittest.main()
