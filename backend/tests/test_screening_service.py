"""ScreeningService tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ConflictError, ValidationError
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
        screening_call.vapi_call_id = "vapi-1"
        executed = MagicMock()
        executed.scalars.return_value.first.return_value = None
        session.execute = AsyncMock(return_value=executed)

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


def _actor():
    return User(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com", full_name="HR",
        hashed_password="x", role="hr", is_active=True,
    )


def _completed_call():
    call = MagicMock()
    call.id = uuid.uuid4()
    call.call_status = "completed"
    call.result = "pass"
    call.candidate_id = uuid.uuid4()
    call.job_id = uuid.uuid4()
    return call


class UpdateResultGuardTests(unittest.IsolatedAsyncioTestCase):
    async def _run(self, *, shortlist, in_interviews):
        session = AsyncMock()
        executed = MagicMock()
        executed.scalars.return_value.first.return_value = shortlist
        session.execute = AsyncMock(return_value=executed)
        call = _completed_call()
        interview_repo = MagicMock()
        interview_repo.candidate_ids_with_sessions = AsyncMock(
            return_value={call.candidate_id} if in_interviews else set()
        )
        audit = AsyncMock()
        service = ScreeningService(session, screening_repo=MagicMock(), interview_repo=interview_repo, audit_service=audit)
        with patch("app.services.screening_service.get_tenant_screening_call", AsyncMock(return_value=call)):
            with self.assertRaises(ConflictError) as ctx:
                await service.update_result(_actor(), call.id, ScreeningResultUpdate(result="fail"))
        audit.log_change.assert_not_awaited()
        session.commit.assert_not_awaited()
        self.assertEqual(call.result, "pass")
        return ctx.exception

    async def test_refused_for_a_rejected_candidate(self):
        await self._run(shortlist=MagicMock(hr_decision="rejected"), in_interviews=False)

    async def test_refused_once_the_candidate_has_an_interview(self):
        await self._run(shortlist=MagicMock(hr_decision="approved"), in_interviews=True)

    async def test_refused_with_an_interview_and_no_shortlist_row(self):
        await self._run(shortlist=None, in_interviews=True)


if __name__ == "__main__":
    unittest.main()
