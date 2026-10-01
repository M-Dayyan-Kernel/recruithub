"""ShortlistRepository tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import NotFoundError
from app.repositories.shortlist_repository import ShortlistRepository


class ShortlistRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_for_tenant_raises_when_missing(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=result)

        repo = ShortlistRepository(session)
        with self.assertRaises(NotFoundError):
            await repo.get_for_tenant(uuid.uuid4(), uuid.uuid4())

    async def test_list_for_job_returns_records(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        session.execute = AsyncMock(return_value=result)

        repo = ShortlistRepository(session)
        records = await repo.list_for_job(uuid.uuid4())
        self.assertEqual(records, [])

    async def test_count_for_candidates_empty(self):
        session = AsyncMock()
        repo = ShortlistRepository(session)
        count = await repo.count_for_candidates(uuid.uuid4(), [])
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
