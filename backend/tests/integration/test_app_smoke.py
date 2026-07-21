"""Integration smoke tests (no external services required)."""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.main import app


class AppSmokeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health_live(self) -> None:
        resp = self.client.get("/health/live")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "ok")

    def test_metrics_endpoint(self) -> None:
        resp = self.client.get("/metrics")
        self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()
