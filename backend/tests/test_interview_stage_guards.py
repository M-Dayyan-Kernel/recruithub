"""Finalist, link and pipeline guards that keep a rejected candidate rejected."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from datetime import datetime, timezone

from fastapi import HTTPException

from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.services import interview_round_service as rounds
from app.services.interview_hr_service import InterviewHrService


class MarkFinalistGuardTests(unittest.IsolatedAsyncioTestCase):
    """Marking a finalist needs a taken, meaningful round, and never overrides a rejection."""

    def _sessions(self, status="completed", **kw):
        base = dict(id=uuid.uuid4(), status=status, round_number=1, voided_at=None,
                    created_at=datetime.now(timezone.utc), started_at=None)
        base.update(kw)
        return [NS(**base)]

    async def _mark(self, shortlist, sessions, *, flagged=False):
        db = AsyncMock()
        with patch.object(rounds, "_shortlist", AsyncMock(return_value=shortlist)), \
             patch.object(rounds, "load_sessions", AsyncMock(return_value=sessions)):
            result = await rounds.mark_finalist(
                db, candidate_id=uuid.uuid4(), job_id=uuid.uuid4(), actor_id=uuid.uuid4(), flagged=flagged
            )
        return result, db

    def _row(self, **kw):
        base = dict(hr_decision="approved", finalist_at=None, finalist_by_user_id=None)
        base.update(kw)
        return NS(**base)

    async def test_refused_when_shortlist_rejected(self):
        with self.assertRaises(ConflictError):
            await self._mark(self._row(hr_decision="rejected"), self._sessions())

    async def test_unknown_candidate_is_not_found(self):
        with self.assertRaises(NotFoundError):
            await self._mark(None, self._sessions())

    async def test_marks_flushes_and_leaves_the_commit_to_the_caller(self):
        row = self._row()
        _, db = await self._mark(row, self._sessions())
        self.assertIsNotNone(row.finalist_at)
        self.assertIsNotNone(row.finalist_by_user_id)
        db.flush.assert_awaited()
        db.commit.assert_not_awaited()

    async def test_marking_twice_changes_nothing(self):
        at = datetime(2026, 10, 1, tzinfo=timezone.utc)
        row = self._row(finalist_at=at)
        await self._mark(row, self._sessions())
        self.assertEqual(row.finalist_at, at)

    async def test_needs_a_taken_round(self):
        for label, sessions in (("none", []), ("pending", self._sessions("pending")), ("live", self._sessions("in_progress"))):
            with self.subTest(label), self.assertRaises(ValidationError):
                await self._mark(self._row(), sessions)

    async def test_a_flagged_round_cannot_be_marked(self):
        with self.assertRaises(ValidationError):
            await self._mark(self._row(), self._sessions(), flagged=True)

    async def test_a_voided_round_does_not_count(self):
        sessions = self._sessions(voided_at=datetime.now(timezone.utc))
        with self.assertRaises(ValidationError):
            await self._mark(self._row(), sessions)


class RefuseIfRejectedTests(unittest.IsolatedAsyncioTestCase):
    async def _check(self, shortlist):
        db = MagicMock()
        first = MagicMock()
        first.scalars.return_value.first.return_value = shortlist
        db.execute = AsyncMock(side_effect=[first])
        svc = InterviewHrService(db, interview_repo=MagicMock(), audit_service=MagicMock())
        await svc._refuse_if_rejected(NS(id=uuid.uuid4(), job_id=uuid.uuid4()))
        return db

    async def test_rejected_shortlist_is_refused_with_409(self):
        with self.assertRaises(HTTPException) as ctx:
            await self._check(NS(hr_decision="rejected"))
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_normal_candidate_and_missing_shortlist_pass(self):
        await self._check(NS(hr_decision="approved"))
        await self._check(None)

    async def test_the_shortlist_row_is_locked_first(self):
        db = await self._check(NS(hr_decision="approved"))
        first_sql = str(db.execute.await_args_list[0].args[0])
        self.assertIn("FOR UPDATE", first_sql)
        self.assertIn("shortlist_results", first_sql)


class SendLinkScopeTests(unittest.IsolatedAsyncioTestCase):
    async def test_pass_lookup_is_scoped_to_the_job_and_completed_calls(self):
        db = MagicMock()
        none = MagicMock()
        none.scalars.return_value.first.return_value = None
        db.execute = AsyncMock(return_value=none)
        svc = InterviewHrService(db, interview_repo=MagicMock(), audit_service=MagicMock())
        svc._refuse_if_rejected = AsyncMock()
        cand = NS(id=uuid.uuid4(), job_id=uuid.uuid4())
        with patch("app.services.interview_hr_service.get_tenant_candidate", AsyncMock(return_value=cand)):
            with self.assertRaises(HTTPException) as ctx:
                await svc.send_link(NS(tenant_id=uuid.uuid4()), cand.id)
        self.assertEqual(ctx.exception.status_code, 400)
        sql = str(db.execute.await_args_list[0].args[0]).lower()
        self.assertIn("job_id", sql)
        self.assertIn("call_status", sql)


if __name__ == "__main__":
    unittest.main()
