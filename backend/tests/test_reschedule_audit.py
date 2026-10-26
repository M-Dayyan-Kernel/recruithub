import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.schemas.schemas import InterviewScheduleRequest
from app.services.interview_hr_service import InterviewHrService


def _service(new_session, previous):
    db = MagicMock()
    db.commit = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: {new_session.id: new_session, previous.id: previous}[pk])
    audit = MagicMock()
    audit.log_change = AsyncMock()
    svc = InterviewHrService(db, interview_repo=MagicMock(), audit_service=audit)
    svc._candidate_label = AsyncMock(return_value="Cand")
    svc._refuse_if_rejected = AsyncMock()
    return svc, audit


class RescheduleAuditTests(unittest.IsolatedAsyncioTestCase):
    async def _run(self, new_at, body):
        previous = SimpleNamespace(id=uuid.uuid4(), scheduled_interview_at=datetime(2026, 10, 20, 9, 30, tzinfo=timezone.utc))
        new = SimpleNamespace(id=uuid.uuid4(), scheduled_interview_at=new_at, rescheduled_from_session_id=previous.id)
        svc, audit = _service(new, previous)
        with patch("app.services.interview_hr_service.get_tenant_candidate", AsyncMock(return_value=SimpleNamespace(job_id=uuid.uuid4()))), \
             patch("app.services.interview_reschedule_service.reschedule_interview", AsyncMock(return_value=new)):
            await svc.reschedule(SimpleNamespace(tenant_id=uuid.uuid4()), uuid.uuid4(), body)
        return audit.log_change.await_args.kwargs, new

    async def test_records_new_and_previous_time(self):
        at = datetime(2026, 10, 24, 9, 30, tzinfo=timezone.utc)
        kw, new = await self._run(at, InterviewScheduleRequest(scheduled_date="2026-10-24", scheduled_time="15:00"))
        self.assertEqual(kw["after"]["scheduled_interview_at"], at.isoformat())
        self.assertEqual(kw["after"]["timezone"], "Asia/Kolkata")
        self.assertEqual(kw["before"]["scheduled_interview_at"], "2026-10-20T09:30:00+00:00")
        self.assertEqual(kw["after"]["session_id"], str(new.id))

    async def test_link_only_reschedule_records_null_time(self):
        kw, _ = await self._run(None, None)
        self.assertIsNone(kw["after"]["scheduled_interview_at"])
        self.assertIsNone(kw["after"]["timezone"])


if __name__ == "__main__":
    unittest.main()
