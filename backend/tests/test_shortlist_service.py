"""ShortlistService tests."""

import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ValidationError
from app.models.models import User
from app.schemas.schemas import ShortlistDecisionUpdate, ShortlistFeedbackCreate
from app.services.shortlist_service import ShortlistService


class ShortlistServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_update_decision_rejects_invalid_hr_decision(self):
        session = AsyncMock()
        shortlist_repo = MagicMock()
        audit = AsyncMock()

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = ShortlistService(
            session, shortlist_repo=shortlist_repo, audit_service=audit
        )

        with self.assertRaises(ValidationError):
            await service.update_decision(
                actor,
                uuid.uuid4(),
                ShortlistDecisionUpdate(hr_decision="invalid"),
            )

    async def test_submit_feedback_updates_fields(self):
        session = AsyncMock()
        shortlist_repo = MagicMock()
        audit = AsyncMock()
        shortlist_repo.refresh = AsyncMock()

        record = MagicMock()
        record.id = uuid.uuid4()
        record.candidate_id = uuid.uuid4()
        record.job_id = uuid.uuid4()
        record.hr_feedback_type = None
        record.hr_comments = None
        record.match_score = 80.0
        record.recommendation = "shortlisted"
        record.strengths = []
        record.gaps = []
        record.reason = "Good fit"
        record.hr_decision = "pending"
        record.model_name = "gpt"
        record.prompt_version = "v1"
        record.created_at = datetime.now(timezone.utc)

        shortlist_repo.get_for_tenant = AsyncMock(return_value=record)
        candidate = MagicMock()
        candidate.name = "Jane"
        session.get = AsyncMock(return_value=candidate)

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = ShortlistService(
            session, shortlist_repo=shortlist_repo, audit_service=audit
        )

        result = await service.submit_feedback(
            actor,
            record.id,
            ShortlistFeedbackCreate(
                hr_feedback_type="correctly_shortlisted",
                hr_comments="Agree",
            ),
        )

        self.assertEqual(record.hr_feedback_type, "correctly_shortlisted")
        audit.log_field_changes.assert_awaited_once()
        session.commit.assert_awaited_once()
        self.assertEqual(result.hr_comments, "Agree")

    async def test_list_results_returns_empty_when_no_records(self):
        session = AsyncMock()
        shortlist_repo = MagicMock()
        shortlist_repo.list_for_job = AsyncMock(return_value=[])

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = ShortlistService(session, shortlist_repo=shortlist_repo)

        with patch(
            "app.services.shortlist_service.get_tenant_job",
            new_callable=AsyncMock,
        ):
            results = await service.list_results(actor, uuid.uuid4())

        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
