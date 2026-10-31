"""Queueing question writing, and reading projects from a resume."""

import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch

from app.schemas.ai_outputs import ParsedResumeData
from app.tasks import interview_tasks


class EnqueueTests(unittest.TestCase):
    def test_a_seeded_interview_is_queued(self):
        with patch.object(interview_tasks.generate_interview_plan, "delay") as delay:
            interview_tasks.enqueue_interview_plan(NS(id="s1", plan_status="seeded"))
        delay.assert_called_once_with("s1")

    def test_an_interview_with_no_plan_or_a_written_one_is_not(self):
        for status in ("pending", "generated"):
            with self.subTest(status), patch.object(interview_tasks.generate_interview_plan, "delay") as delay:
                interview_tasks.enqueue_interview_plan(NS(id="s1", plan_status=status))
            delay.assert_not_called()

    def test_a_queue_that_is_down_does_not_fail_the_request(self):
        with patch.object(interview_tasks.generate_interview_plan, "delay", side_effect=ConnectionError("redis")):
            interview_tasks.enqueue_interview_plan(NS(id="s1", plan_status="seeded"))

    def test_the_task_is_routed_to_the_interviews_queue(self):
        from app.core.celery_queues import INTERVIEWS_QUEUE, TASK_ROUTES

        self.assertEqual(TASK_ROUTES["tasks.generate_interview_plan"], {"queue": INTERVIEWS_QUEUE})

    def test_a_failed_task_is_logged_not_retried(self):
        with patch.object(interview_tasks, "_async_generate_plan", side_effect=RuntimeError("boom")), \
             patch.object(interview_tasks.asyncio, "run", side_effect=RuntimeError("boom")):
            interview_tasks.generate_interview_plan("s1")  # does not raise


class ResumeProjectsTests(unittest.TestCase):
    def test_projects_are_read_from_the_parse(self):
        parsed = ParsedResumeData.model_validate({
            "projects": [{"name": "Chat app", "description": "Realtime", "technologies": ["Node", 3, None]}],
        })
        self.assertEqual(parsed.projects[0].name, "Chat app")
        self.assertEqual(parsed.projects[0].technologies, ["Node", "3"])

    def test_a_resume_with_no_projects_still_parses(self):
        for raw in ({}, {"projects": None}, {"projects": []}):
            self.assertEqual(ParsedResumeData.model_validate(raw).projects, [])

    def test_a_bad_technologies_value_is_ignored_not_fatal(self):
        parsed = ParsedResumeData.model_validate({"projects": [{"name": "X", "technologies": "Node"}]})
        self.assertEqual(parsed.projects[0].technologies, [])


if __name__ == "__main__":
    unittest.main()
