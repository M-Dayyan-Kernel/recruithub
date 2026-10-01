"""Integration smoke tests for Part 1 routes."""

import unittest

from fastapi.testclient import TestClient

from app.main import app


class Part1AuthSmokeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_live(self):
        response = self.client.get("/health/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_login_invalid_credentials(self):
        response = self.client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "wrong-password-xyz"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("detail", response.json())

    def test_me_requires_auth(self):
        response = self.client.get("/api/auth/me")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
