"""Tests for interview live-slot capacity limiting."""

from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from app.services import interview_queue_service


class InterviewQueueServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_count_live_interviews(self) -> None:
        session = mock.AsyncMock()
        count_result = mock.Mock()
        count_result.scalar.return_value = 7
        session.execute = mock.AsyncMock(return_value=count_result)

        self.assertEqual(await interview_queue_service.count_live_interviews(session), 7)

    async def test_has_slot_when_under_cap(self) -> None:
        session = mock.AsyncMock()
        count_result = mock.Mock()
        count_result.scalar.return_value = 2
        session.execute = mock.AsyncMock(return_value=count_result)

        with mock.patch.object(
            interview_queue_service.config.interview,
            "max_concurrent_interviews",
            25,
        ), mock.patch(
            "app.clients.mocks.mock_livekit_enabled",
            return_value=False,
        ):
            self.assertTrue(await interview_queue_service.has_live_interview_slot(session))

    async def test_no_slot_when_at_cap(self) -> None:
        session = mock.AsyncMock()
        count_result = mock.Mock()
        count_result.scalar.return_value = 25
        session.execute = mock.AsyncMock(return_value=count_result)

        with mock.patch.object(
            interview_queue_service.config.interview,
            "max_concurrent_interviews",
            25,
        ), mock.patch(
            "app.clients.mocks.mock_livekit_enabled",
            return_value=False,
        ):
            self.assertFalse(await interview_queue_service.has_live_interview_slot(session))

    async def test_mock_livekit_bypasses_cap(self) -> None:
        session = mock.AsyncMock()
        count_result = mock.Mock()
        count_result.scalar.return_value = 999
        session.execute = mock.AsyncMock(return_value=count_result)

        with mock.patch(
            "app.clients.mocks.mock_livekit_enabled",
            return_value=True,
        ):
            self.assertTrue(await interview_queue_service.has_live_interview_slot(session))
            session.execute.assert_not_called()

    def test_busy_retry_minutes_from_config(self) -> None:
        with mock.patch.object(
            interview_queue_service.config.interview,
            "busy_retry_minutes",
            45,
        ):
            self.assertEqual(interview_queue_service.busy_retry_minutes(), 45)


class InterviewCapacityEnforcementTests(unittest.IsolatedAsyncioTestCase):
    async def test_raise_interview_capacity_full(self) -> None:
        from app.exceptions import InterviewCapacityError
        from app.services.interview_public_service import _raise_interview_capacity_full

        with mock.patch(
            "app.services.interview_queue_service.busy_retry_minutes",
            return_value=45,
        ):
            with self.assertRaises(InterviewCapacityError) as ctx:
                _raise_interview_capacity_full()

        self.assertEqual(ctx.exception.status_code, 503)
        detail = ctx.exception.response_content["detail"]
        self.assertEqual(detail["code"], "interview_capacity_full")
        self.assertEqual(detail["retry_after_minutes"], 45)

    async def test_start_pending_raises_503_when_at_cap(self) -> None:
        from app.exceptions import InterviewCapacityError
        from app.services.interview_public_service import InterviewPublicService

        session = SimpleNamespace(
            status="pending",
            candidate_id=uuid.uuid4(),
            job_id=uuid.uuid4(),
            unique_token="tok",
            id=uuid.uuid4(),
            livekit_room_name=None,
        )
        candidate = SimpleNamespace(name="Test Candidate")
        job = SimpleNamespace(tenant_id=uuid.uuid4(), title="Engineer")

        def _execute_result(value, *, scalar_one: bool = False):
            result = mock.Mock()
            if scalar_one:
                result.scalar_one_or_none = mock.Mock(return_value=value)
            else:
                result.scalars = mock.Mock(
                    return_value=mock.Mock(first=mock.Mock(return_value=value))
                )
            return result

        db = mock.AsyncMock()
        db.execute = mock.AsyncMock(
            side_effect=[
                _execute_result(candidate),
                _execute_result(job),
            ]
        )

        integrations = mock.Mock()
        integrations.livekit_url = "wss://lk.example"
        integrations.require = mock.Mock()

        interview_repo = mock.Mock()
        interview_repo.get_session_by_token = mock.AsyncMock(return_value=session)
        service = InterviewPublicService(db, interview_repo=interview_repo)

        with mock.patch(
            "app.services.interview_guards.enforce_public_interview_rate_limit",
        ), mock.patch(
            "app.services.interview_guards.assert_session_joinable",
            new=mock.AsyncMock(),
        ), mock.patch(
            "app.services.tenant_integrations_service.load_tenant_integrations",
            new=mock.AsyncMock(return_value=integrations),
        ), mock.patch(
            "app.services.interview_queue_service.has_live_interview_slot",
            new=mock.AsyncMock(return_value=False),
        ), mock.patch(
            "app.services.interview_queue_service.busy_retry_minutes",
            return_value=45,
        ):
            with self.assertRaises(InterviewCapacityError) as ctx:
                await service.start("tok")

        detail = ctx.exception.response_content["detail"]
        self.assertEqual(detail["code"], "interview_capacity_full")

    async def test_rejoin_allowed_when_at_cap(self) -> None:
        from app.services.interview_public_service import InterviewPublicService

        session = SimpleNamespace(
            status="in_progress",
            livekit_room_name="interview-abc",
            candidate_id=uuid.uuid4(),
            job_id=uuid.uuid4(),
            id=uuid.uuid4(),
        )
        candidate = SimpleNamespace(name="Test Candidate")
        job = SimpleNamespace(tenant_id=uuid.uuid4())

        def _execute_result(value, *, scalar_one: bool = False):
            result = mock.Mock()
            if scalar_one:
                result.scalar_one_or_none = mock.Mock(return_value=value)
            else:
                result.scalars = mock.Mock(
                    return_value=mock.Mock(first=mock.Mock(return_value=value))
                )
            return result

        db = mock.AsyncMock()
        db.execute = mock.AsyncMock(
            side_effect=[
                _execute_result(candidate),
                _execute_result(job),
            ]
        )

        integrations = mock.Mock()
        integrations.livekit_url = "wss://lk.example"
        integrations.require = mock.Mock()

        interview_repo = mock.Mock()
        interview_repo.get_session_by_token = mock.AsyncMock(return_value=session)
        service = InterviewPublicService(db, interview_repo=interview_repo)

        with mock.patch(
            "app.services.interview_guards.enforce_public_interview_rate_limit",
        ), mock.patch(
            "app.services.interview_guards.assert_session_joinable",
            new=mock.AsyncMock(),
        ), mock.patch(
            "app.services.tenant_integrations_service.load_tenant_integrations",
            new=mock.AsyncMock(return_value=integrations),
        ), mock.patch(
            "app.services.livekit_service.generate_candidate_token",
            return_value="jwt-token",
        ), mock.patch(
            "app.services.interview_queue_service.has_live_interview_slot",
            new=mock.AsyncMock(return_value=False),
        ) as has_slot:
            response = await service.start("tok")

        has_slot.assert_not_called()
        self.assertEqual(response.token, "jwt-token")
        self.assertEqual(response.room_name, "interview-abc")


if __name__ == "__main__":
    unittest.main()
