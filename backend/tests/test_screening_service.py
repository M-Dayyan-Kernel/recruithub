"""ScreeningService tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ValidationError
from app.models.models import User
from app.schemas.schemas import ScreeningResultUpdate
from app.services.screening_service import ScreeningService


class ScreeningServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_update_result_raises_when_call_not_completed(self):
        session = AsyncMock()
        audit = AsyncMock()
        screening_call = MagicMock()
        screening_call.call_status = "in_progress"
        screening_call.candidate_id = uuid.uuid4()
        screening_call.job_id = uuid.uuid4()

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )
        service = ScreeningService(session, audit_service=audit)

        with patch(
            "app.services.screening_service.get_tenant_screening_call",
            new_callable=AsyncMock,
            return_value=screening_call,
        ):
            with self.assertRaises(ValidationError):
                await service.update_result(
                    actor,
                    uuid.uuid4(),
                    ScreeningResultUpdate(result="pass"),
                )

    async def test_update_result_logs_audit_when_completed(self):
        session = AsyncMock()
        audit = AsyncMock()
        screening_repo = MagicMock()
        interview_repo = MagicMock()
        interview_repo.candidate_ids_with_sessions = AsyncMock(return_value=set())
        screening_repo.refresh = AsyncMock()

        screening_call = MagicMock()
        screening_call.id = uuid.uuid4()
        screening_call.call_status = "completed"
        screening_call.result = None
        screening_call.candidate_id = uuid.uuid4()
        screening_call.job_id = uuid.uuid4()
        screening_call.interview_queued_at = None

        actor = User(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            email="hr@example.com",
            full_name="HR",
            hashed_password="x",
            role="hr",
            is_active=True,
        )
        service = ScreeningService(
            session,
            screening_repo=screening_repo,
            interview_repo=interview_repo,
            audit_service=audit,
        )

        with patch(
            "app.services.screening_service.get_tenant_screening_call",
            new_callable=AsyncMock,
            return_value=screening_call,
        ):
            with patch.object(session, "get", new_callable=AsyncMock, return_value=None):
                with patch.object(
                    ScreeningService,
                    "_to_response",
                    return_value=MagicMock(),
                ):
                    await service.update_result(
                        actor,
                        screening_call.id,
                        ScreeningResultUpdate(result="pass"),
                    )

        audit.log_change.assert_awaited_once()
        session.commit.assert_awaited()


if __name__ == "__main__":
    unittest.main()
