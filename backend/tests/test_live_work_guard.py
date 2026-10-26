"""Deleting or erasing while a call or interview is live is refused."""

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import ConflictError
from app.services import live_work_guard as guard
from app.services.candidate_service import CandidateService
from app.services.job_service import JobService


def _res(rows=None, first=None, scalar=None):
    r = MagicMock()
    r.scalars.return_value.all.return_value = rows or []
    r.scalars.return_value.first.return_value = first
    r.scalar.return_value = scalar
    return r


def _call(status, vapi=None):
    return SimpleNamespace(call_status=status, vapi_call_id=vapi)


class CandidateGuardTests(unittest.IsolatedAsyncioTestCase):
    async def _run(self, calls, in_progress):
        db = AsyncMock()
        # shortlist lock, calls, live session, pending sessions (locked)
        db.execute = AsyncMock(side_effect=[_res(), _res(rows=calls), _res(first=uuid.uuid4() if in_progress else None), _res()])
        try:
            await guard.assert_candidate_not_live(db, uuid.uuid4(), uuid.uuid4())
            return None
        except ConflictError as e:
            return e.public_message

    async def test_a_call_on_its_way_blocks(self):
        for c in (_call("initiated", "v"), _call("in_progress", "v"), _call("pending", "v")):
            self.assertIn("on a call", await self._run([c], False), c.call_status)

    async def test_an_interview_in_progress_blocks(self):
        self.assertIn("in an interview", await self._run([], True))

    async def test_queued_cancelled_failed_and_finished_calls_do_not_block(self):
        calls = [_call("pending", None), _call("cancelled"), _call("failed", "v"), _call("completed", "v")]
        self.assertIsNone(await self._run(calls, False))

    async def test_a_pending_or_expired_interview_link_does_not_block(self):
        self.assertIsNone(await self._run([], False))


class CandidateGuardSqlTests(unittest.IsolatedAsyncioTestCase):
    """What the guard actually asks the database (the mocks above only fake the answers)."""

    async def test_it_locks_shortlist_calls_and_sessions_in_that_order_and_filters_correctly(self):
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[_res(), _res(rows=[]), _res(first=None), _res()])
        await guard.assert_candidate_not_live(db, uuid.uuid4(), uuid.uuid4())
        sql = [str(c.args[0].compile(compile_kwargs={"literal_binds": False})) for c in db.execute.await_args_list]
        self.assertEqual(len(sql), 4)
        self.assertIn("shortlist_results", sql[0]); self.assertIn("FOR UPDATE", sql[0])
        self.assertIn("screening_calls", sql[1]); self.assertIn("FOR UPDATE", sql[1])
        self.assertIn("interview_sessions", sql[2]); self.assertIn("FOR UPDATE", sql[2])
        self.assertIn("started_at", sql[2])  # the staleness bound is part of the question
        self.assertIn("interview_sessions", sql[3]); self.assertIn("FOR UPDATE", sql[3])  # pending links held too
        for q in sql:
            self.assertIn("job_id", q); self.assertIn("candidate_id", q)


class JobGuardTests(unittest.IsolatedAsyncioTestCase):
    async def _run(self, calls, interviews):
        db = AsyncMock()
        # candidate ids on a call, then candidate ids in an interview
        db.execute = AsyncMock(side_effect=[_res(rows=[uuid.uuid4() for _ in range(calls)]), _res(rows=[uuid.uuid4() for _ in range(interviews)])])
        try:
            await guard.assert_job_not_live(db, uuid.uuid4())
            return None
        except ConflictError as e:
            return e.public_message

    async def test_counts_people_live_and_says_so(self):
        self.assertIn("1 candidate is", await self._run(1, 0))
        self.assertIn("3 candidates are", await self._run(2, 1))

    async def test_nobody_live_is_fine(self):
        self.assertIsNone(await self._run(0, 0))

    async def test_one_candidate_on_a_call_and_in_an_interview_counts_once(self):
        both = uuid.uuid4()
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[_res(rows=[both]), _res(rows=[both])])
        with self.assertRaises(ConflictError) as ctx:
            await guard.assert_job_not_live(db, uuid.uuid4())
        self.assertIn("1 candidate is", ctx.exception.public_message)


class ServiceWiringTests(unittest.IsolatedAsyncioTestCase):
    """The guard must run before anything is deleted or erased."""

    def _actor(self):
        return SimpleNamespace(id=uuid.uuid4(), tenant_id=uuid.uuid4())

    async def test_candidate_delete_and_erase_stop_before_touching_anything(self):
        cand = SimpleNamespace(id=uuid.uuid4(), job_id=uuid.uuid4())
        repo, audit, storage = MagicMock(), AsyncMock(), MagicMock()
        repo.delete = AsyncMock()
        svc = CandidateService(AsyncMock(), candidate_repo=repo, audit_service=audit, storage=storage, queue_service=AsyncMock())
        with patch("app.services.candidate_service.get_tenant_candidate", AsyncMock(return_value=cand)), \
             patch("app.services.candidate_service.assert_candidate_not_live", AsyncMock(side_effect=ConflictError(public_message="live"))), \
             patch("app.services.candidate_service.erase_candidate_pii", AsyncMock()) as erase:
            with self.assertRaises(ConflictError):
                await svc.delete(self._actor(), cand.id)
            with self.assertRaises(ConflictError):
                await svc.gdpr_erase(self._actor(), cand.id)
        repo.delete.assert_not_awaited()
        audit.log_change.assert_not_awaited()
        erase.assert_not_awaited()

    async def test_job_delete_stops_before_deleting(self):
        job = SimpleNamespace(id=uuid.uuid4(), title="J", status="open")
        repo = MagicMock()
        repo.get_for_tenant = AsyncMock(return_value=job)
        repo.delete = AsyncMock()
        audit = AsyncMock()
        svc = JobService(AsyncMock(), job_repo=repo, audit_service=audit)
        with patch("app.services.job_service.assert_job_not_live", AsyncMock(side_effect=ConflictError(public_message="live"))):
            with self.assertRaises(ConflictError):
                await svc.delete(self._actor(), job.id)
        repo.delete.assert_not_awaited()
        audit.log_change.assert_not_awaited()


class RetentionSweepTests(unittest.IsolatedAsyncioTestCase):
    async def test_the_sweep_skips_a_candidate_who_is_live_and_erases_the_rest(self):
        from app.services import retention_service as rs

        live = SimpleNamespace(id=uuid.uuid4(), job_id=uuid.uuid4(), email="live@x.io")
        old = SimpleNamespace(id=uuid.uuid4(), job_id=uuid.uuid4(), email="old@x.io")
        done = SimpleNamespace(id=uuid.uuid4(), job_id=uuid.uuid4(), email="gone@erased.local")
        db = AsyncMock()
        settings_row = SimpleNamespace(data_retention_days=30)
        job_rows = MagicMock(); job_rows.all.return_value = [(uuid.uuid4(),)]
        db.execute = AsyncMock(side_effect=[_res(first=settings_row), job_rows, _res(rows=[live, done, old])])

        async def guard_stub(_db, job_id, candidate_id):
            if candidate_id == live.id:
                raise ConflictError(public_message="live")

        with patch.object(rs, "assert_candidate_not_live", guard_stub), \
             patch.object(rs, "erase_candidate_pii", AsyncMock()) as erase:
            n = await rs.apply_retention_for_tenant(db, uuid.uuid4())
        self.assertEqual(n, 1)
        erased = [c.args[1] for c in erase.await_args_list]
        self.assertEqual(erased, [old])


if __name__ == "__main__":
    unittest.main()
