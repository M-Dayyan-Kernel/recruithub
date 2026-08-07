"""Unit tests for the talentOS integration interview slot scheduling."""

from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.modules.talentos_integration.talentos_integration_service import (
    TalentosIntegrationService,
    _parse_scheduled_slot,
)
import app.modules.talentos_integration.talentos_integration_service as service_module


class ParseScheduledSlotTests(unittest.TestCase):
    def test_parses_kolkata_slot_to_utc(self):
        value = _parse_scheduled_slot("2026-07-21", "16:00", "Asia/Kolkata")
        self.assertEqual(value, datetime(2026, 7, 21, 10, 30, tzinfo=timezone.utc))

    def test_rejects_bad_date(self):
        with self.assertRaises(ValueError):
            _parse_scheduled_slot("21-07-2026", "16:00", "Asia/Kolkata")

    def test_rejects_bad_time(self):
        with self.assertRaises(ValueError):
            _parse_scheduled_slot("2026-07-21", "4pm", "Asia/Kolkata")

    def test_rejects_bad_timezone(self):
        with self.assertRaises(ValueError):
            _parse_scheduled_slot("2026-07-21", "16:00", "Mars/Olympus")


class ScheduleInterviewTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.session = AsyncMock()
        self.service = TalentosIntegrationService(self.session)
        self.actor = MagicMock()
        self.job_id = uuid.uuid4()
        self.candidate_id = uuid.uuid4()
        self.candidate = MagicMock(id=self.candidate_id, job_id=self.job_id)
        self.interview_session = MagicMock(status="pending")

        self.service._effective_tenant_id = AsyncMock(return_value=uuid.uuid4())
        self.service._require_tenant_job = AsyncMock()
        self.session.get = AsyncMock(return_value=self.candidate)

        result_mock = MagicMock()
        result_mock.scalars.return_value.first.return_value = self.interview_session
        self.session.execute = AsyncMock(return_value=result_mock)

    def _payload(self, date_: str | None, time_: str | None, tz: str | None = "Asia/Kolkata"):
        payload = MagicMock()
        payload.scheduled_date = date_
        payload.scheduled_time = time_
        payload.timezone = tz
        return payload

    async def test_sets_slot_and_expiry(self):
        scheduled = (datetime.now(timezone.utc) + timedelta(days=3)).replace(
            second=0, microsecond=0
        )
        with patch.object(
            service_module.config,
            "interview",
            SimpleNamespace(session_link_ttl_days=7),
        ):
            await self.service.schedule_interview(
                self.actor,
                self.job_id,
                self.candidate_id,
                self._payload(
                    scheduled.strftime("%Y-%m-%d"),
                    scheduled.strftime("%H:%M"),
                    "UTC",
                ),
            )
        self.assertEqual(self.interview_session.scheduled_interview_at, scheduled)
        self.assertEqual(
            self.interview_session.expires_at,
            scheduled + timedelta(days=7),
        )

    async def test_clear_slot(self):
        self.interview_session.scheduled_interview_at = datetime(2026, 7, 21, 16, 0, tzinfo=timezone.utc)
        with patch.object(
            service_module.config,
            "interview",
            SimpleNamespace(session_link_ttl_days=7),
        ):
            await self.service.schedule_interview(
                self.actor, self.job_id, self.candidate_id, None
            )
        self.assertIsNone(self.interview_session.scheduled_interview_at)

    async def test_rejects_past_slot(self):
        with self.assertRaises(service_module.ConflictError):
            with patch.object(
                service_module.config,
                "interview",
                SimpleNamespace(session_link_ttl_days=7),
            ):
                await self.service.schedule_interview(
                    self.actor,
                    self.job_id,
                    self.candidate_id,
                    self._payload("2020-01-01", "00:00", "UTC"),
                )

    async def test_rejects_malformed_slot(self):
        with self.assertRaises(service_module.ValidationError):
            await self.service.schedule_interview(
                self.actor,
                self.job_id,
                self.candidate_id,
                self._payload("not-a-date", "16:00", "UTC"),
            )

    async def test_no_pending_session_raises_not_found(self):
        result_mock = MagicMock()
        result_mock.scalars.return_value.first.return_value = None
        self.session.execute = AsyncMock(return_value=result_mock)
        with self.assertRaises(service_module.NotFoundError):
            await self.service.schedule_interview(
                self.actor, self.job_id, self.candidate_id, None
            )


if __name__ == "__main__":
    unittest.main()
