"""InterviewRepository tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock

from app.repositories.interview_repository import InterviewRepository


class InterviewRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_session_by_token_returns_none(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=result)

        repo = InterviewRepository(session)
        record = await repo.get_session_by_token("token-abc")
        self.assertIsNone(record)

    async def test_list_for_job_returns_records(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        session.execute = AsyncMock(return_value=result)

        repo = InterviewRepository(session)
        records = await repo.list_for_job(uuid.uuid4())
        self.assertEqual(records, [])

    async def test_candidate_ids_with_sessions(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = [uuid.uuid4()]
        session.execute = AsyncMock(return_value=result)

        repo = InterviewRepository(session)
        ids = await repo.candidate_ids_with_sessions(uuid.uuid4())
        self.assertEqual(len(ids), 1)


if __name__ == "__main__":
    unittest.main()
