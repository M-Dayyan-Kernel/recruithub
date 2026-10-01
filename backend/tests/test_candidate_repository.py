"""CandidateRepository tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import NotFoundError
from app.repositories.candidate_repository import CandidateRepository


class CandidateRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_for_job_raises_when_missing(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=result)

        repo = CandidateRepository(session)
        with self.assertRaises(NotFoundError):
            await repo.get_for_job(uuid.uuid4(), uuid.uuid4())

    async def test_find_by_filename_returns_none_when_missing(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=result)

        repo = CandidateRepository(session)
        found = await repo.find_by_filename(uuid.uuid4(), "resume.pdf")
        self.assertIsNone(found)

    async def test_list_for_job_returns_candidates(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        session.execute = AsyncMock(return_value=result)

        repo = CandidateRepository(session)
        items = await repo.list_for_job(
            uuid.uuid4(),
            pipeline_statuses=["queued"],
            offset=0,
            limit=10,
        )
        self.assertEqual(items, [])


if __name__ == "__main__":
    unittest.main()
