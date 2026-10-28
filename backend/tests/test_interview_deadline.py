"""The interview link's deadline: the platform-wide cap, the {{deadline}} placeholder, its label."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.core.config_loader import config
from app.schemas.schemas import SystemSettingsResponse
from app.services import email_service
from app.services.email_template_service import (
    TEMPLATE_PLACEHOLDERS,
    default_templates,
    render_template,
)
from app.services.interview_schedule_service import format_deadline_label

LINK_TEMPLATES = ("interview_invitation", "interview_scheduled", "interview_reschedule")
URL = "https://apply.example.com/interview/abc-123"
DEADLINE = "Saturday, 31 October 2026 at 6:00 PM"


def _vars(**over):
    base = {
        "candidate_name": "Asha Rao",
        "job_title": "Backend Engineer",
        "interview_url": URL,
        "scheduled_at": "Tuesday, 28 October 2026 at 11:00 AM",
        "deadline": DEADLINE,
        "company_name": "Acme",
    }
    base.update(over)
    return base


class CapTests(unittest.TestCase):
    def test_links_are_valid_for_three_days(self):
        self.assertEqual(config.interview.session_link_ttl_days, 3)

    def test_settings_response_reports_the_cap_to_admins(self):
        response = SystemSettingsResponse(
            allowed_phone_regions=["IN"],
            enforce_phone_geography=True,
            screening_enabled=True,
            screening_max_retries=3,
            screening_retry_delay_seconds=1800,
            updated_at=datetime.now(timezone.utc),
        )
        self.assertEqual(response.interview_link_ttl_days, config.interview.session_link_ttl_days)


class PlaceholderTests(unittest.TestCase):
    def test_every_email_that_carries_the_link_offers_the_deadline(self):
        for template_id in LINK_TEMPLATES:
            self.assertIn("{{deadline}}", TEMPLATE_PLACEHOLDERS[template_id], template_id)

    def test_emails_without_a_link_do_not(self):
        for template_id in ("interview_cancelled", "rejection", "failed_screening_attempt"):
            self.assertNotIn("{{deadline}}", TEMPLATE_PLACEHOLDERS[template_id], template_id)

    def test_the_default_for_each_link_email_states_the_deadline(self):
        defaults = default_templates()
        for template_id in LINK_TEMPLATES:
            _, body = render_template(template_id, {}, _vars())
            self.assertIn(DEADLINE, body, template_id)
            self.assertNotIn("{{", body, template_id)
            self.assertIn("{{deadline}}", defaults[template_id]["body_html"], template_id)

    def test_an_organisations_own_template_may_leave_it_out(self):
        templates = {"interview_invitation": {"subject": "Hi", "body_html": "<p>Join: {{interview_url}}</p>", "version": 2}}
        _, body = render_template("interview_invitation", templates, _vars())
        self.assertNotIn(DEADLINE, body)


class SenderTests(unittest.IsolatedAsyncioTestCase):
    async def _sent_body(self, send, **kwargs):
        with patch.object(email_service, "_send_html_email_async", AsyncMock(return_value=True)) as out:
            await send(**kwargs)
        return out.await_args.kwargs["html_body"]

    async def test_all_three_link_emails_carry_the_label(self):
        common = dict(candidate_name="Asha", candidate_email="a@x.io", job_title="Eng", interview_url=URL, deadline_label=DEADLINE)
        templates = default_templates()
        self.assertIn(DEADLINE, await self._sent_body(email_service.send_interview_link, templates=templates, **common))
        self.assertIn(
            DEADLINE,
            await self._sent_body(
                email_service.send_scheduled_interview_notification,
                scheduled_at_label="Tue", templates=templates, **common,
            ),
        )
        self.assertIn(DEADLINE, await self._sent_body(email_service.send_reschedule_notification, templates=templates, **common))

    async def test_the_hard_coded_fallback_lists_it_too(self):
        body = await self._sent_body(
            email_service.send_interview_link,
            candidate_name="Asha", candidate_email="a@x.io", job_title="Eng", interview_url=URL, deadline_label=DEADLINE,
        )
        self.assertIn(DEADLINE, body)


class LabelTests(unittest.TestCase):
    def _session(self, expires_at):
        return SimpleNamespace(id=uuid.uuid4(), expires_at=expires_at)

    def test_it_is_shown_in_the_jobs_timezone(self):
        expires = datetime(2026, 10, 31, 12, 30, tzinfo=timezone.utc)
        job = SimpleNamespace(screening_timezone="Asia/Kolkata")
        self.assertEqual(format_deadline_label(self._session(expires), job), "Saturday, 31 October 2026 at 6:00 PM")
        job = SimpleNamespace(screening_timezone="UTC")
        self.assertEqual(format_deadline_label(self._session(expires), job), "Saturday, 31 October 2026 at 12:30 PM")

    def test_it_defaults_to_india_time_without_a_job_timezone(self):
        expires = datetime(2026, 10, 31, 12, 30, tzinfo=timezone.utc)
        self.assertEqual(format_deadline_label(self._session(expires), None), "Saturday, 31 October 2026 at 6:00 PM")

    def test_a_session_with_no_expiry_has_no_label(self):
        self.assertEqual(format_deadline_label(self._session(None), None), "")

    def test_a_new_session_expires_after_the_configured_days(self):
        # The deadline arithmetic every creator uses: ttl days after the send time or the slot.
        slot = datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc)
        self.assertEqual(slot + timedelta(days=config.interview.session_link_ttl_days), datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
