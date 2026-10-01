"""Tests for stuck processing recovery using processing_started_at."""

from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock

from app.services import processing_queue_service


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeSession:
    def __init__(self, stuck):
        self.stuck = stuck
        self.committed = False

    async def execute(self, _query):
        return _FakeResult(self.stuck)

    async def flush(self):
        pass

    async def commit(self):
        self.committed = True


class _FakeCandidate:
    def __init__(self, *, started_at: datetime | None):
        self.id = uuid.uuid4()
        self.pipeline_status = "processing"
        self.processing_started_at = started_at
        self.original_filename = "resume.pdf"
        self.name = "Test"


class RecoverStuckProcessingTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovers_old_processing_started_at(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(minutes=30)
        cand = _FakeCandidate(started_at=old)
        session = _FakeSession([cand])

        with mock.patch("app.tasks.resume_tasks.process_resume_shortlist") as task:
            task.apply_async = mock.Mock()
            recovered = await processing_queue_service.recover_stuck_processing(session)

        self.assertEqual(recovered, 1)
        self.assertEqual(cand.pipeline_status, "queued")
        self.assertTrue(session.committed)
        task.apply_async.assert_called_once_with(args=[str(cand.id)])


if __name__ == "__main__":
    unittest.main()
