"""When a scheduled interview opens, and how that is shown to the candidate."""

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

from app.services.interview_guards import format_for_candidate, seconds_until_open

NOW = datetime(2026, 11, 2, 7, 17, tzinfo=timezone.utc)  # 12:47 pm IST
SLOT = datetime(2026, 11, 2, 7, 30, tzinfo=timezone.utc)  # 1:00 pm IST


class SecondsUntilOpenTests(unittest.TestCase):
    def test_a_future_slot_counts_down_to_the_slot_minus_the_grace(self):
        # 13 minutes to the slot, 2 minutes of grace: 11 minutes to wait.
        self.assertEqual(seconds_until_open(NS(scheduled_interview_at=SLOT), NOW), 11 * 60)

    def test_it_opens_at_the_grace_boundary_and_stays_open(self):
        opens = SLOT - timedelta(seconds=120)
        self.assertIsNone(seconds_until_open(NS(scheduled_interview_at=SLOT), opens))
        self.assertIsNone(seconds_until_open(NS(scheduled_interview_at=SLOT), SLOT))
        self.assertIsNone(seconds_until_open(NS(scheduled_interview_at=SLOT), SLOT + timedelta(hours=5)))
        self.assertEqual(seconds_until_open(NS(scheduled_interview_at=SLOT), opens - timedelta(seconds=1)), 1)

    def test_part_of_a_second_rounds_up_so_the_page_never_opens_early(self):
        just_before = SLOT - timedelta(seconds=120) - timedelta(milliseconds=400)
        self.assertEqual(seconds_until_open(NS(scheduled_interview_at=SLOT), just_before), 1)

    def test_no_fixed_time_means_open_now(self):
        self.assertIsNone(seconds_until_open(NS(scheduled_interview_at=None), NOW))
        self.assertIsNone(seconds_until_open(NS(), NOW))


class CandidateTimeFormatTests(unittest.TestCase):
    def test_times_are_shown_in_indian_standard_time(self):
        self.assertEqual(format_for_candidate(SLOT), "Mon, 02 Nov 2026, 01:00 PM IST")

    def test_it_does_not_depend_on_the_zone_the_instant_came_in(self):
        other_zone = SLOT.astimezone(timezone(timedelta(hours=-8)))
        self.assertEqual(format_for_candidate(other_zone), format_for_candidate(SLOT))


if __name__ == "__main__":
    unittest.main()
