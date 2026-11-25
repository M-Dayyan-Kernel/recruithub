import unittest
from types import SimpleNamespace

from app.exceptions import ConflictError, JobClosedError, JobPausedError
from app.services.job_status import (
    assert_accepts_new_work,
    assert_editable,
    assert_status_change_allowed,
    is_active,
)


def _job(status):
    return SimpleNamespace(status=status)


class JobStatusTests(unittest.TestCase):
    def test_open_and_active_are_both_live(self):
        for status in ("open", "active"):
            self.assertTrue(is_active(_job(status)))
            assert_accepts_new_work(_job(status), "add resumes")

    def test_a_paused_job_holds_new_work_and_says_how_to_continue(self):
        with self.assertRaises(JobPausedError) as ctx:
            assert_accepts_new_work(_job("paused"), "send interview invites")
        self.assertEqual(
            ctx.exception.public_message,
            "This job is paused. Reactivate it to send interview invites.",
        )
        self.assertEqual(ctx.exception.status_code, 409)

    def test_a_paused_job_stays_editable(self):
        assert_editable(_job("paused"))

    def test_a_closed_job_refuses_new_work_and_edits(self):
        with self.assertRaises(JobClosedError):
            assert_accepts_new_work(_job("closed"), "add resumes")
        with self.assertRaises(JobClosedError) as ctx:
            assert_editable(_job("closed"))
        self.assertIn("Duplicate it", ctx.exception.public_message)
        self.assertIsInstance(ctx.exception, ConflictError)

    def test_closing_is_final(self):
        assert_status_change_allowed(_job("paused"), "open")
        assert_status_change_allowed(_job("open"), "closed")
        assert_status_change_allowed(_job("paused"), "closed")
        with self.assertRaises(JobClosedError):
            assert_status_change_allowed(_job("closed"), "open")


if __name__ == "__main__":
    unittest.main()
