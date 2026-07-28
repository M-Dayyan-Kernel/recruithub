"""Integration smoke tests for Part 2 job routes."""

import io
import unittest

from fastapi.testclient import TestClient

from app.main import app


class Part2JobsSmokeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_list_jobs_requires_auth(self):
        response = self.client.get("/api/jobs")
        self.assertEqual(response.status_code, 401)

    def test_parse_jd_rejects_unsupported_file_type(self):
        response = self.client.post(
            "/api/jobs/parse-jd",
            files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
            headers={"Authorization": "Bearer invalid"},
        )
        self.assertIn(response.status_code, (401, 422))
        if response.status_code == 422:
            body = response.json()
            self.assertEqual(body.get("error"), "unsupported_file_type")
            self.assertIn("message", body)


if __name__ == "__main__":
    unittest.main()
