"""Tests for Celery health helpers."""

from __future__ import annotations

import unittest
from unittest import mock

from app.core.celery_queues import RESUME_QUEUE, SCREENING_QUEUE
from app.services import celery_health


class CeleryHealthTests(unittest.TestCase):
    def test_workers_available_when_ping_returns_workers(self) -> None:
        inspect = mock.Mock()
        inspect.ping.return_value = {"worker1@host": {"ok": "pong"}}
        with mock.patch.object(celery_health, "_inspect", return_value=inspect):
            self.assertTrue(celery_health.celery_workers_available())

    def test_workers_unavailable_when_ping_empty(self) -> None:
        inspect = mock.Mock()
        inspect.ping.return_value = None
        with mock.patch.object(celery_health, "_inspect", return_value=inspect):
            self.assertFalse(celery_health.celery_workers_available())

    def test_queue_available_when_worker_subscribed(self) -> None:
        inspect = mock.Mock()
        inspect.ping.return_value = {"worker1@host": {"ok": "pong"}}
        inspect.active_queues.return_value = {
            "worker1@host": [{"name": RESUME_QUEUE}],
        }
        with mock.patch.object(celery_health, "_inspect", return_value=inspect):
            self.assertTrue(celery_health.celery_queue_available(RESUME_QUEUE))

    def test_queue_unavailable_when_not_subscribed(self) -> None:
        inspect = mock.Mock()
        inspect.ping.return_value = {"worker1@host": {"ok": "pong"}}
        inspect.active_queues.return_value = {
            "worker1@host": [{"name": SCREENING_QUEUE}],
        }
        with mock.patch.object(celery_health, "_inspect", return_value=inspect):
            self.assertFalse(celery_health.celery_queue_available(RESUME_QUEUE))

    def test_health_snapshot_reports_subscribed_queues(self) -> None:
        inspect = mock.Mock()
        inspect.ping.return_value = {"worker1@host": {"ok": "pong"}}
        inspect.active_queues.return_value = {
            "worker1@host": [{"name": RESUME_QUEUE}, {"name": SCREENING_QUEUE}],
        }
        with (
            mock.patch.object(celery_health, "_inspect", return_value=inspect),
            mock.patch.object(
                celery_health,
                "get_queue_lengths",
                return_value={"resume": 2, "shortlist": 0, "screening": 0, "interviews": 0},
            ),
        ):
            snapshot = celery_health.get_celery_health_snapshot()

        self.assertEqual(snapshot["workers_online"], 1)
        self.assertIn(RESUME_QUEUE, snapshot["subscribed_queues"])
        self.assertIn(SCREENING_QUEUE, snapshot["subscribed_queues"])
        self.assertTrue(snapshot["queues_ready"]["resume"])


if __name__ == "__main__":
    unittest.main()
