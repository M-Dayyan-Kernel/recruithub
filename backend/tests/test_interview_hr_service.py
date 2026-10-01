"""InterviewHrService tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.models import User
from app.services.interview_hr_service import InterviewHrService


class InterviewHrServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_pipeline_delegates_to_builder(self):
        session = AsyncMock()
        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )
        job_id = uuid.uuid4()
        expected = MagicMock()
        service = InterviewHrService(session)

        with patch(
            "app.services.interview_hr_service.get_tenant_job",
            new_callable=AsyncMock,
        ):
            with patch(
                "app.services.interview_pipeline_service.get_interview_pipeline",
                new_callable=AsyncMock,
                return_value=expected,
            ) as mock_pipeline:
                result = await service.get_pipeline(actor, job_id, tab="pending")
        self.assertIs(result, expected)
        mock_pipeline.assert_awaited_once_with(session, job_id, tab="pending")

    async def test_queue_raises_when_screening_not_passed(self):
        session = AsyncMock()
        interview_repo = MagicMock()
        interview_repo.get_latest_pass_screening_call = AsyncMock(return_value=None)
        audit = AsyncMock()

        candidate = MagicMock()
        candidate.id = uuid.uuid4()
        candidate.job_id = uuid.uuid4()
        candidate.name = "Alice"

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )
        service = InterviewHrService(
            session, interview_repo=interview_repo, audit_service=audit
        )

        from fastapi import HTTPException

        with patch(
            "app.services.interview_hr_service.get_tenant_candidate",
            new_callable=AsyncMock,
            return_value=candidate,
        ):
            with self.assertRaises(HTTPException) as ctx:
                await service.queue(actor, candidate.id)
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
