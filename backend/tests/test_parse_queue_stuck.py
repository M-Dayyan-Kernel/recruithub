"""Tests for stuck-parse recovery using parse_started_at."""

from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock

from app.services import parse_queue_service


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
        self.flushed = 0

    async def execute(self, _query):
        return _FakeResult(self.stuck)

    async def flush(self):
        self.flushed += 1

    async def commit(self):
        self.committed = True


class _FakeCandidate:
    def __init__(self, *, status: str, started_at: datetime | None):
        self.id = uuid.uuid4()
        self.parse_status = status
        self.parse_started_at = started_at
        self.original_filename = "resume.pdf"
        self.name = "Test"


class RecoverStuckParsesTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovers_old_parse_started_at(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(minutes=30)
        cand = _FakeCandidate(status="parsing", started_at=old)
        session = _FakeSession([cand])

        with mock.patch("app.tasks.resume_tasks.extract_resume_text") as extract_task:
            extract_task.apply_async = mock.Mock()
            recovered = await parse_queue_service.recover_stuck_parses(session)

        self.assertEqual(recovered, 1)
        self.assertEqual(cand.parse_status, "parse_queued")
        self.assertIsNotNone(cand.parse_started_at)
        self.assertTrue(session.committed)
        extract_task.apply_async.assert_called_once_with(args=[str(cand.id)])

    async def test_ignores_null_parse_started_at(self) -> None:
        # Query filters parse_started_at IS NOT NULL — session returns empty.
        session = _FakeSession([])
        with mock.patch("app.tasks.resume_tasks.extract_resume_text"):
            recovered = await parse_queue_service.recover_stuck_parses(session)
        self.assertEqual(recovered, 0)
        self.assertFalse(session.committed)


if __name__ == "__main__":
    unittest.main()
