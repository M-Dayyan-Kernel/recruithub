"""JobRepository tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import NotFoundError
from app.repositories.job_repository import JobRepository


class JobRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_for_tenant_raises_when_missing(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=result)

        repo = JobRepository(session)
        with self.assertRaises(NotFoundError):
            await repo.get_for_tenant(uuid.uuid4(), uuid.uuid4())

    async def test_list_for_tenant_applies_status_filter(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        session.execute = AsyncMock(return_value=result)

        repo = JobRepository(session)
        tenant_id = uuid.uuid4()
        jobs = await repo.list_for_tenant(tenant_id, status="active")
        self.assertEqual(jobs, [])
        session.execute.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
