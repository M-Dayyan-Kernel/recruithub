"""Tests for Celery queue routing configuration."""

from __future__ import annotations

import unittest

from app.core.celery_app import celery_app
from app.core.celery_queues import CELERY_QUEUE_NAMES, ROUTED_TASK_NAMES, TASK_ROUTES


class CeleryRoutingTests(unittest.TestCase):
    def test_all_included_tasks_are_routed(self) -> None:
        app_tasks = {
            name
            for name in celery_app.tasks
            if name.startswith("tasks.") and not name.endswith("_task")
        }
        unrouted = sorted(app_tasks - ROUTED_TASK_NAMES)
        self.assertEqual(unrouted, [], msg=f"Unrouted tasks: {unrouted}")

    def test_routes_target_named_queues_only(self) -> None:
        for task_name, route in TASK_ROUTES.items():
            self.assertIn(
                route["queue"],
                CELERY_QUEUE_NAMES,
                msg=f"{task_name} routes to unknown queue {route['queue']}",
            )

    def test_celery_app_registers_named_queues(self) -> None:
        configured = {queue.name for queue in celery_app.conf.task_queues}
        self.assertEqual(configured, set(CELERY_QUEUE_NAMES))

    def test_celery_app_uses_central_routes(self) -> None:
        self.assertEqual(dict(celery_app.conf.task_routes), TASK_ROUTES)

    def test_connect_reconciler_uses_default_queue(self) -> None:
        self.assertEqual(TASK_ROUTES["tasks.reconcile_pending_connections"]["queue"], "celery")
        self.assertIn("celery", CELERY_QUEUE_NAMES)


if __name__ == "__main__":
    unittest.main()
