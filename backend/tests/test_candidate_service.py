"""CandidateService tests."""

import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import CandidateNotRetryableError
from app.models.models import User
from app.schemas.schemas import CandidateUpdate
from app.services.candidate_service import CandidateService


class CandidateServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_processing_rejects_invalid_status(self):
        session = AsyncMock()
        candidate_repo = MagicMock()
        audit = AsyncMock()
        storage = MagicMock()
        queue = AsyncMock()

        candidate = MagicMock()
        candidate.job_id = uuid.uuid4()
        candidate.pipeline_status = "invalid"
        candidate.id = uuid.uuid4()

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = CandidateService(
            session,
            candidate_repo=candidate_repo,
            audit_service=audit,
            storage=storage,
            queue_service=queue,
        )

        with unittest.mock.patch(
            "app.services.candidate_service.get_tenant_job",
            new_callable=AsyncMock,
        ):
            with unittest.mock.patch(
                "app.services.candidate_service.get_tenant_candidate",
                new_callable=AsyncMock,
                return_value=candidate,
            ):
                with self.assertRaises(CandidateNotRetryableError):
                    await service.retry_processing(actor, candidate.job_id, candidate.id)

    async def test_update_applies_field_changes(self):
        session = AsyncMock()
        audit = AsyncMock()
        candidate_repo = MagicMock()
        candidate_repo.refresh = AsyncMock()

        candidate = MagicMock()
        candidate.id = uuid.uuid4()
        candidate.job_id = uuid.uuid4()
        candidate.name = "Old"
        candidate.email = "old@example.com"
        candidate.phone = None
        candidate.original_filename = "resume.pdf"
        candidate.pipeline_status = "completed"
        candidate.created_at = datetime.now(timezone.utc)
        # A bare MagicMock hands back a Mock for any attribute not set here,
        # which CandidateResponse rejects. Pin every field the schema reads.
        candidate.status = "active"
        candidate.years_experience = None
        candidate.current_ctc = None
        candidate.expected_ctc = None
        candidate.notice_period = None
        candidate.last_working_day = None

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
            result = await service.update(
                actor,
                candidate.id,
                CandidateUpdate(name="New"),
            )

        self.assertEqual(candidate.name, "New")
        audit.log_field_changes.assert_awaited_once()
        session.commit.assert_awaited_once()
        self.assertEqual(result.name, "New")


if __name__ == "__main__":
    unittest.main()
