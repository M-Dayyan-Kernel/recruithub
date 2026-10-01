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

    def test_health_live_api_prefix_alias(self) -> None:
        resp = self.client.get("/api/health/live")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "ok")

    def test_health_ready_returns_200_even_when_degraded(self) -> None:
        resp = self.client.get("/health/ready")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn(body["status"], ("ok", "degraded"))
        self.assertIn("checks", body)

    def test_metrics_endpoint(self) -> None:
        resp = self.client.get("/metrics")
        self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()
