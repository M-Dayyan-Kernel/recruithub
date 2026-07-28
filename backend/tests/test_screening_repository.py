"""ScreeningRepository tests."""

import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import NotFoundError
from app.repositories.screening_repository import ScreeningRepository


class ScreeningRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_for_tenant_raises_when_missing(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        session.execute = AsyncMock(return_value=result)

        repo = ScreeningRepository(session)
        with self.assertRaises(NotFoundError):
            await repo.get_for_tenant(uuid.uuid4(), uuid.uuid4())

    async def test_get_by_vapi_call_id_returns_none(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalars.return_value.first.return_value = None
        session.execute = AsyncMock(return_value=result)

        repo = ScreeningRepository(session)
        record = await repo.get_by_vapi_call_id("call-123")
        self.assertIsNone(record)

    async def test_list_for_job_returns_records(self):
        session = AsyncMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        session.execute = AsyncMock(return_value=result)

        repo = ScreeningRepository(session)
        records = await repo.list_for_job(uuid.uuid4())
        self.assertEqual(records, [])


if __name__ == "__main__":
    unittest.main()
