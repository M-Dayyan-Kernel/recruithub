"""Stuck-resume recovery and dispatch: one sender, a token per send, and an attempt cap."""

from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock

from app.services import processing_queue_service
from app.services.processing_queue_service import (
    MAX_PROCESSING_ATTEMPTS,
    ProcessingQueueService,
    is_processing_stalled,
)


class _FakeResult:
    def __init__(self, rows=None, scalar=0):
        self._rows = rows or []
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def scalar(self):
        return self._scalar


class _FakeSession:
    """Answers queries in order: each execute() pops the next prepared result."""

    def __init__(self, *results):
        self.results = list(results)
        self.commits = 0
        self.events: list[str] = []

    async def execute(self, _query):
        return self.results.pop(0) if self.results else _FakeResult()

    async def flush(self):
        pass

    async def commit(self):
        self.commits += 1
        self.events.append("commit")


def _candidate(**over):
    c = mock.Mock()
    c.id = uuid.uuid4()
    c.job_id = uuid.uuid4()
    c.pipeline_status = "processing"
    c.processing_started_at = None
    c.processing_retry_at = None
    c.pipeline_status_at = None
    c.processing_attempts = 1
    c.processing_token = "old"
    c.original_filename = "resume.pdf"
    c.name = "Test"
    for k, v in over.items():
        setattr(c, k, v)
    return c


def _ago(minutes):
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


class StalledTests(unittest.TestCase):
    def test_a_quiet_attempt_past_the_timeout_is_stalled(self):
        self.assertTrue(is_processing_stalled(_candidate(processing_started_at=_ago(30))))
        self.assertFalse(is_processing_stalled(_candidate(processing_started_at=_ago(1))))

    def test_a_row_waiting_for_its_retry_is_not_stalled_until_the_retry_is_overdue(self):
        waiting = _candidate(processing_started_at=_ago(30), processing_retry_at=_ago(-3))
        self.assertFalse(is_processing_stalled(waiting))
        overdue = _candidate(processing_started_at=_ago(30), processing_retry_at=_ago(10))
        self.assertTrue(is_processing_stalled(overdue))

    def test_only_processing_rows_can_stall(self):
        self.assertFalse(is_processing_stalled(_candidate(pipeline_status="queued", processing_started_at=_ago(30))))


class RecoverStuckTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovery_requeues_without_sending_then_dispatch_sends_once(self):
        stuck = _candidate(processing_started_at=_ago(30))
        session = _FakeSession(_FakeResult([stuck]))
        service = ProcessingQueueService(session)
        with mock.patch.object(service, "dispatch_slots", mock.AsyncMock()) as dispatch, \
                mock.patch("app.tasks.resume_tasks.process_resume_shortlist") as task:
            recovered = await service.recover_stuck()

        self.assertEqual(recovered, 1)
        self.assertEqual(stuck.pipeline_status, "queued")
        self.assertIsNone(stuck.processing_token)
        task.apply_async.assert_not_called()
        dispatch.assert_awaited_once_with(stuck.job_id)

    async def test_a_row_waiting_for_a_future_retry_is_left_alone(self):
        waiting = _candidate(processing_started_at=_ago(30), processing_retry_at=_ago(-3))
        session = _FakeSession(_FakeResult([waiting]))
        recovered = await processing_queue_service.recover_stuck_processing(session)
        self.assertEqual(recovered, 0)
        self.assertEqual(waiting.pipeline_status, "processing")

    async def test_a_row_out_of_attempts_is_failed_not_requeued(self):
        spent = _candidate(processing_started_at=_ago(30), processing_attempts=MAX_PROCESSING_ATTEMPTS)
        session = _FakeSession(_FakeResult([spent]))
        service = ProcessingQueueService(session)
        with mock.patch.object(service, "dispatch_slots", mock.AsyncMock()):
            await service.recover_stuck()
        self.assertEqual(spent.pipeline_status, "failed")
        self.assertTrue(spent.pipeline_error.startswith("Stopped repeatedly"))


class DispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_each_send_carries_a_fresh_token_and_follows_the_commit(self):
        queued = _candidate(pipeline_status="queued", processing_token=None)
        session = _FakeSession(
            _FakeResult([]),            # nothing stuck
            _FakeResult(scalar=0),      # nothing active
            _FakeResult([queued]),      # one waiting
        )
        with mock.patch("app.tasks.resume_tasks.process_resume_shortlist") as task:
            task.apply_async.side_effect = lambda **_: session.events.append("send")
            sent = await ProcessingQueueService(session).dispatch_slots(queued.job_id)

        self.assertEqual(sent, 1)
        self.assertEqual(queued.pipeline_status, "processing")
        self.assertEqual(len(queued.processing_token), 32)
        task.apply_async.assert_called_once_with(args=[str(queued.id), queued.processing_token])
        self.assertEqual(session.events, ["commit", "send"])


if __name__ == "__main__":
    unittest.main()
