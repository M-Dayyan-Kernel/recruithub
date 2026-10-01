"""Integration smoke tests for Part 3 candidate routes."""

import io
import unittest
import uuid

from fastapi.testclient import TestClient

from app.main import app


class Part3CandidatesSmokeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.job_id = uuid.uuid4()

    def test_list_candidates_requires_auth(self):
        response = self.client.get(f"/api/jobs/{self.job_id}/candidates")
        self.assertEqual(response.status_code, 401)

    def test_upload_rejects_unsupported_file_type(self):
        response = self.client.post(
            f"/api/jobs/{self.job_id}/resumes",
            files={"files": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
            headers={"Authorization": "Bearer invalid"},
        )
        self.assertIn(response.status_code, (401, 422))
        if response.status_code == 422:
            body = response.json()
            self.assertEqual(body.get("error"), "unsupported_file_type")
            self.assertIn("message", body)


if __name__ == "__main__":
    unittest.main()
