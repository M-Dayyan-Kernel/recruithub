"""ScreeningTriggerService tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import EmptyCandidateIdsError, ScreeningDisabledError
from app.models.models import User
from app.schemas.schemas import ScreeningTriggerRequest
from app.services.screening_trigger_service import ScreeningTriggerService


class ScreeningTriggerServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_trigger_raises_when_empty_candidate_ids(self):
        session = AsyncMock()
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
        service = ScreeningTriggerService(session, audit_service=audit)

        with self.assertRaises(EmptyCandidateIdsError):
            await service.trigger(
                actor,
                uuid.uuid4(),
                ScreeningTriggerRequest(candidate_ids=[], force=False),
            )

    async def test_trigger_raises_when_screening_disabled(self):
        session = AsyncMock()
        audit = AsyncMock()
        job = MagicMock()
        job.id = uuid.uuid4()
        job.title = "Engineer"
        job.tenant_id = uuid.uuid4()

        actor = User(
            id=uuid.uuid4(),
            tenant_id=job.tenant_id,
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )
        service = ScreeningTriggerService(session, audit_service=audit)

        with patch(
            "app.services.screening_trigger_service.get_tenant_job",
            new_callable=AsyncMock,
            return_value=job,
        ):
            with patch(
                "app.services.celery_health.celery_queue_available_async",
                new_callable=AsyncMock,
                return_value=True,
            ):
                with patch(
                    "app.services.settings_service.load_system_settings",
                    new_callable=AsyncMock,
                    return_value=MagicMock(),
                ):
                    with patch(
                        "app.services.screening_gate_service.screening_disabled_reason",
                        return_value="Screening is disabled for this job.",
                    ):
                        with self.assertRaises(ScreeningDisabledError):
                            await service.trigger(
                                actor,
                                job.id,
                                ScreeningTriggerRequest(
                                    candidate_ids=[str(uuid.uuid4())],
                                    force=False,
                                ),
                            )


if __name__ == "__main__":
    unittest.main()
