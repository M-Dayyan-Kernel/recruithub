"""Interview decision, link and pipeline guards that keep a rejected candidate rejected."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.exceptions import ConflictError
from app.services import interview_finalist_service as finalist
from app.services.interview_hr_service import InterviewHrService


def _result(value):
    r = MagicMock()
    r.scalars.return_value.first.return_value = value
    r.scalar_one_or_none.return_value = value
    r.scalars.return_value.all.return_value = [value] if value is not None else []
    return r


class SetDecisionGuardTests(unittest.IsolatedAsyncioTestCase):
    def _db(self, *, shortlist, session):
        cand = NS(id=uuid.uuid4(), job_id=uuid.uuid4(), name="C")
        db = AsyncMock()
        db.get = AsyncMock(return_value=cand)
        results = [_result(shortlist), _result(session), _result(object())]
        db.execute = AsyncMock(side_effect=results)
        return db, cand

    async def test_approve_refused_when_shortlist_rejected(self):
        db, cand = self._db(shortlist=NS(hr_decision="rejected"), session=None)
        with self.assertRaises(ConflictError):
            await finalist.set_interview_hr_decision(db, cand.id, "approved")
        db.commit.assert_not_awaited()

    async def test_finalist_cannot_be_flipped_to_rejected(self):
        session = NS(id=uuid.uuid4(), hr_decision="approved", status="completed", job_id=uuid.uuid4())
        db, cand = self._db(shortlist=NS(hr_decision="approved"), session=session)
        with patch.object(finalist, "_session_is_completed_for_decision", return_value=True):
            with self.assertRaises(ConflictError):
                await finalist.set_interview_hr_decision(db, cand.id, "rejected")
        self.assertEqual(session.hr_decision, "approved")

    async def test_decision_flushes_and_leaves_the_commit_to_the_caller(self):
        session = NS(
            id=uuid.uuid4(), candidate_id=uuid.uuid4(), job_id=uuid.uuid4(), hr_decision="pending", status="completed", unique_token="tok"
        )
        db, cand = self._db(shortlist=NS(hr_decision="approved"), session=session)
        db.get = AsyncMock(side_effect=[cand, None])
        with patch.object(finalist, "_session_is_completed_for_decision", return_value=True), patch.object(
            finalist.InterviewSessionResponse, "model_validate", return_value=NS(interview_url=None, candidate_name=None, job_title=None, id=session.id)
        ):
            await finalist.set_interview_hr_decision(db, cand.id, "rejected")
        self.assertEqual(session.hr_decision, "rejected")
        db.flush.assert_awaited()
        db.commit.assert_not_awaited()


class RefuseIfRejectedTests(unittest.IsolatedAsyncioTestCase):
    async def _check(self, shortlist, latest_decision):
        db = MagicMock()
        first = MagicMock()
        first.scalars.return_value.first.return_value = shortlist
        second = MagicMock()
        second.scalars.return_value.first.return_value = latest_decision
        db.execute = AsyncMock(side_effect=[first, second])
        svc = InterviewHrService(db, interview_repo=MagicMock(), audit_service=MagicMock())
        await svc._refuse_if_rejected(NS(id=uuid.uuid4(), job_id=uuid.uuid4()))
        return db

    async def test_rejected_shortlist_is_refused_with_409(self):
        with self.assertRaises(HTTPException) as ctx:
            await self._check(NS(hr_decision="rejected"), "pending")
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_rejected_latest_interview_is_refused(self):
        with self.assertRaises(HTTPException):
            await self._check(NS(hr_decision="approved"), "rejected")

    async def test_normal_candidate_and_missing_shortlist_pass(self):
        await self._check(NS(hr_decision="approved"), "pending")
        await self._check(None, None)

    async def test_the_shortlist_row_is_locked_first(self):
        db = await self._check(NS(hr_decision="approved"), None)
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
