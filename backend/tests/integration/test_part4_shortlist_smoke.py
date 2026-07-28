"""Integration smoke tests for Part 4 shortlist routes."""

import unittest
import uuid

from fastapi.testclient import TestClient

from app.main import app


class Part4ShortlistSmokeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.job_id = uuid.uuid4()

    def test_list_shortlist_requires_auth(self):
        response = self.client.get(f"/api/jobs/{self.job_id}/shortlist")
        self.assertEqual(response.status_code, 401)

    def test_trigger_shortlist_requires_auth(self):
        response = self.client.post(f"/api/jobs/{self.job_id}/shortlist", json={})
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
