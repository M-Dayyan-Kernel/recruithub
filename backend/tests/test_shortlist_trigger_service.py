"""ShortlistTriggerService tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import NoEligibleCandidatesError, ShortlistInProgressError
from app.models.models import User
from app.services.shortlist_trigger_service import ShortlistTriggerService


class ShortlistTriggerServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_trigger_raises_when_no_eligible(self):
        session = AsyncMock()
        shortlist_repo = MagicMock()
        candidate_repo = MagicMock()
        batch_store = MagicMock()
        audit = AsyncMock()

        job = MagicMock()
        job.id = uuid.uuid4()
        job.title = "Engineer"

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = ShortlistTriggerService(
            session,
            shortlist_repo=shortlist_repo,
            candidate_repo=candidate_repo,
            batch_store=batch_store,
            audit_service=audit,
        )

        with patch(
            "app.services.shortlist_trigger_service.get_tenant_job",
            new_callable=AsyncMock,
            return_value=job,
        ):
            with patch.object(
                service,
                "_resolve_eligible_candidate_ids",
                new_callable=AsyncMock,
                return_value=([], [{"id": "x", "reason": "Already shortlisted"}]),
            ):
                with self.assertRaises(NoEligibleCandidatesError) as ctx:
                    await service.trigger(actor, job.id, None)
                self.assertEqual(len(ctx.exception.skipped), 1)

    async def test_trigger_raises_when_lock_not_acquired(self):
        session = AsyncMock()
        batch_store = MagicMock()
        batch_store.acquire_lock = MagicMock(return_value=False)
        audit = AsyncMock()

        job = MagicMock()
        job.id = uuid.uuid4()
        job.title = "Engineer"

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )

        service = ShortlistTriggerService(
            session,
            batch_store=batch_store,
            audit_service=audit,
        )

        with patch(
            "app.services.shortlist_trigger_service.get_tenant_job",
            new_callable=AsyncMock,
            return_value=job,
        ):
            with patch.object(
                service,
                "_resolve_eligible_candidate_ids",
                new_callable=AsyncMock,
                return_value=([uuid.uuid4()], []),
            ):
                with patch(
                    "app.services.shortlist_trigger_service.celery_queue_available_async",
                    new_callable=AsyncMock,
                    return_value=True,
                ):
                    with patch(
                        "app.services.shortlist_trigger_service.run_sync",
                        new_callable=AsyncMock,
                        return_value=False,
                    ):
                        with self.assertRaises(ShortlistInProgressError):
                            await service.trigger(actor, job.id, None)


if __name__ == "__main__":
    unittest.main()
