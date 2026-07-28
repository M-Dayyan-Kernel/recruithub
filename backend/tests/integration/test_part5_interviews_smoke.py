"""Integration smoke tests for Part 5 interview routes."""

import unittest
import uuid
from unittest import mock
from unittest.mock import AsyncMock

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.dependencies import get_interview_public_service
from app.main import app


class Part5InterviewsSmokeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.job_id = uuid.uuid4()

    def test_pipeline_requires_auth(self):
        response = self.client.get(f"/api/jobs/{self.job_id}/interviews/pipeline")
        self.assertEqual(response.status_code, 401)

    def test_public_token_route_no_auth(self):
        mock_service = mock.Mock()
        mock_service.get_session = AsyncMock(
            side_effect=HTTPException(
                status_code=404, detail="Interview session not found"
            )
        )
        app.dependency_overrides[get_interview_public_service] = lambda: mock_service
        try:
            response = self.client.get("/api/interview/nonexistent-token")
            self.assertEqual(response.status_code, 404)
        finally:
            app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
