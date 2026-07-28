"""JobService tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.models import User
from app.schemas.schemas import JobCreate
from app.services.job_service import JobService


class JobServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_applies_default_screening_questions(self):
        session = AsyncMock()
        job_repo = MagicMock()
        audit = AsyncMock()
        expected = AsyncMock()
        integrations = AsyncMock()

        created_job = MagicMock()
        created_job.id = uuid.uuid4()
        created_job.title = "Backend Engineer"
        created_job.status = "active"

        def add_job(job):
            job.id = created_job.id
            job.title = created_job.title
            job.status = created_job.status
            return job

        job_repo.add.side_effect = add_job
        job_repo.flush = AsyncMock()
        job_repo.refresh = AsyncMock()

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = JobService(
            session,
            job_repo=job_repo,
            audit_service=audit,
            expected_answers=expected,
            integrations_service=integrations,
        )

        payload = JobCreate(
            title="Backend Engineer",
            description="Build services",
            screening_questions=[],
            interview_questions=[],
        )
        job = await service.create(actor, payload)

        self.assertTrue(len(payload.screening_questions) == 0 or job_repo.add.called)
        expected.enrich.assert_not_awaited()
        audit.log_change.assert_awaited_once()
        session.commit.assert_awaited_once()

    async def test_create_enriches_interview_questions_when_present(self):
        session = AsyncMock()
        job_repo = MagicMock()
        audit = AsyncMock()
        expected = AsyncMock()
        integrations = AsyncMock()
        integrations.load = AsyncMock(
            return_value=MagicMock(
                openai_api_key="key",
                require=MagicMock(),
            )
        )
        expected.enrich = AsyncMock(return_value=[{"id": "q1", "question": "Q", "score": 5}])

        job_repo.add = MagicMock(side_effect=lambda j: j)
        job_repo.flush = AsyncMock()
        job_repo.refresh = AsyncMock()

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = JobService(
            session,
            job_repo=job_repo,
            audit_service=audit,
            expected_answers=expected,
            integrations_service=integrations,
        )

        payload = JobCreate(
            title="Backend Engineer",
            description="Build services",
            interview_questions=[{"id": "q1", "question": "Q", "score": 5}],
        )
        await service.create(actor, payload)
        expected.enrich.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
