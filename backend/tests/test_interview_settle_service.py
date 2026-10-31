"""Stuck in-progress interviews are settled by what was said."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.dialects import postgresql

from app.services.interview_settle_service import settle_stale_interviews
from app.services.interview_status import is_live, live_clause, stale_after


def _stuck(transcript=None):
    return NS(
        id=uuid.uuid4(), status="in_progress", transcript=transcript, completed_at=None, expires_at=None,
        started_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )


def _db(rows):
    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    db.execute = AsyncMock(return_value=result)
    return db


class SettleStaleInterviewsTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_transcript_means_it_was_taken_and_gets_assessed(self):
        row = _stuck("Interviewer: hi\nCandidate: hello")
        completed, expired = await settle_stale_interviews(_db([row]))
        self.assertEqual((completed, expired), ([row.id], []))
        self.assertEqual(row.status, "completed")
        self.assertIsNotNone(row.completed_at)

    async def test_no_transcript_means_nothing_was_taken(self):
        for transcript in (None, "", "   \n"):
            with self.subTest(transcript=transcript):
                row = _stuck(transcript)
                completed, expired = await settle_stale_interviews(_db([row]))
                self.assertEqual((completed, expired), ([], [row.id]))
                self.assertEqual(row.status, "expired")
                self.assertIsNotNone(row.expires_at)

    async def test_commits_once_only_when_something_changed(self):
        db = _db([_stuck("text")])
        await settle_stale_interviews(db)
        db.commit.assert_awaited_once()
        db = _db([])
        await settle_stale_interviews(db)
        db.commit.assert_not_awaited()

    async def test_the_query_skips_rows_another_worker_holds_and_only_old_ones(self):
        db = _db([])
        await settle_stale_interviews(db)
        sql = str(db.execute.await_args.args[0].compile(dialect=postgresql.dialect())).lower()
        self.assertIn("for update skip locked", sql)
        self.assertIn("started_at <", sql)
        self.assertIn("status", sql)


class LiveWindowTests(unittest.TestCase):
    def test_the_stale_window_is_the_configured_hour(self):
        self.assertEqual(stale_after(), timedelta(minutes=60))

    def test_live_until_the_window_passes(self):
        now = datetime.now(timezone.utc)
        self.assertTrue(is_live(NS(status="in_progress", started_at=now - timedelta(minutes=59))))
        self.assertFalse(is_live(NS(status="in_progress", started_at=now - timedelta(minutes=61))))
        self.assertFalse(is_live(NS(status="completed", started_at=now)))

    def test_the_sql_twin_names_the_same_rule(self):
        sql = str(live_clause().compile(dialect=postgresql.dialect())).lower()
        self.assertIn("interview_sessions.status", sql)
        self.assertIn("interview_sessions.started_at is null", sql)
        self.assertIn("interview_sessions.started_at >", sql)


if __name__ == "__main__":
    unittest.main()
