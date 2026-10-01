"""InterviewPublicService tests."""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.exceptions import InterviewCapacityError
from app.services.interview_public_service import (
    InterviewPublicService,
    _raise_interview_capacity_full,
)


class InterviewPublicServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_session_raises_404_when_missing(self):
        session = AsyncMock()
        interview_repo = MagicMock()
        interview_repo.get_session_by_token = AsyncMock(return_value=None)
        service = InterviewPublicService(session, interview_repo=interview_repo)

        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as ctx:
            await service.get_session("missing-token")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_raise_interview_capacity_full_raises_domain_error(self):
        with patch(
            "app.services.interview_queue_service.busy_retry_minutes",
            return_value=15,
        ):
            with self.assertRaises(InterviewCapacityError) as ctx:
                _raise_interview_capacity_full()
            self.assertEqual(ctx.exception.response_content["detail"]["retry_after_minutes"], 15)


if __name__ == "__main__":
    unittest.main()
