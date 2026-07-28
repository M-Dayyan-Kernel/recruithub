"""Integration smoke tests for Part 5 screening routes."""

import unittest
import uuid

from fastapi.testclient import TestClient

from app.main import app


class Part5ScreeningSmokeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.job_id = uuid.uuid4()

    def test_trigger_screening_requires_auth(self):
        response = self.client.post(
            f"/api/jobs/{self.job_id}/screening/trigger",
            json={"candidate_ids": [str(uuid.uuid4())], "force": False},
        )
        self.assertEqual(response.status_code, 401)

    def test_list_screening_requires_auth(self):
        response = self.client.get(f"/api/jobs/{self.job_id}/screening")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
