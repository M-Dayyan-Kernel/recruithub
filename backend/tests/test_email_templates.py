"""Editable email templates: the interview-scheduled email and the registry it joins."""

import unittest
from unittest.mock import AsyncMock, patch

from app.services import email_service
from app.services.email_template_service import (
    COMMON_PLACEHOLDERS,
    TEMPLATE_IDS,
    TEMPLATE_PLACEHOLDERS,
    default_templates,
    merge_templates,
    preview_template,
    render_template,
    validate_template,
)

SCHEDULED = "interview_scheduled"
SLOT = "Tuesday, 28 October 2026 at 11:00 AM"
DEADLINE = "Saturday, 31 October 2026 at 11:00 AM"
URL = "https://apply.example.com/interview/abc-123"


def _variables(**over):
    base = {
        "candidate_name": "Asha Rao",
        "job_title": "Backend Engineer",
        "interview_url": URL,
        "scheduled_at": SLOT,
        "deadline": DEADLINE,
        "company_name": "Acme",
    }
    base.update(over)
    return base


class RegistryTests(unittest.TestCase):
    def test_every_template_has_a_default_its_placeholders_and_a_preview_sample(self):
        defaults = default_templates()
        for template_id in TEMPLATE_IDS:
            self.assertIn(template_id, defaults, template_id)
            self.assertIn(template_id, TEMPLATE_PLACEHOLDERS, template_id)
            entry = defaults[template_id]
            self.assertEqual(
                validate_template(template_id, entry["subject"], entry["body_html"]),
                [],
                f"default {template_id} must be valid",
            )
            # The preview endpoint fills these in, so a missing sample would leave raw tokens.
            rendered = preview_template(template_id, entry["subject"], entry["body_html"])
            for token in TEMPLATE_PLACEHOLDERS[template_id]:
                self.assertNotIn(token, rendered["subject"] + rendered["body_html"], template_id)

    def test_scheduled_template_offers_the_slot_and_the_link(self):
        offered = TEMPLATE_PLACEHOLDERS[SCHEDULED]
        self.assertIn("{{scheduled_at}}", offered)
        self.assertIn("{{interview_url}}", offered)

    def test_no_template_is_required_to_contain_anything_in_particular(self):
        # What an email says is the organisation's call: any non-empty text is acceptable,
        # including one that leaves out every candidate detail.
        for template_id in TEMPLATE_IDS:
            self.assertEqual(
                validate_template(template_id, "A quick note", "<p>No details at all.</p>"),
                [],
                template_id,
            )

    def test_only_an_empty_subject_or_body_is_rejected(self):
        self.assertEqual(validate_template(SCHEDULED, "", "<p>x</p>"), ["Subject is required"])
        self.assertEqual(validate_template(SCHEDULED, "x", "   "), ["Body is required"])
        self.assertEqual(
            validate_template("not_a_template", "x", "<p>x</p>"),
            ["Unknown template: not_a_template"],
        )

    def test_company_name_is_a_common_detail_not_repeated_per_template(self):
        self.assertIn("{{company_name}}", COMMON_PLACEHOLDERS)
        for template_id in TEMPLATE_IDS:
            self.assertNotIn("{{company_name}}", TEMPLATE_PLACEHOLDERS[template_id])


class RenderTests(unittest.TestCase):
    def test_default_renders_the_slot_link_and_names(self):
        subject, body = render_template(SCHEDULED, {}, _variables())
        self.assertEqual(subject, f"[Interview Scheduled] Backend Engineer — {SLOT}")
        for expected in ("Asha Rao", "Backend Engineer", SLOT, URL, DEADLINE):
            self.assertIn(expected, body)
        self.assertNotIn("{{", body)
        self.assertIn('class="slot"', body)  # the default keeps its highlighted slot block

    def test_none_templates_use_the_default(self):
        merged = merge_templates(None)
        self.assertEqual(merged[SCHEDULED], default_templates()[SCHEDULED])

    def test_a_custom_template_wins(self):
        stored = {
            SCHEDULED: {
                "subject": "See you {{scheduled_at}}",
                "body_html": "<p>Hi {{candidate_name}}, {{job_title}} at {{scheduled_at}}: {{interview_url}}</p>",
                "version": 3,
            }
        }
        subject, body = render_template(SCHEDULED, stored, _variables())
        self.assertEqual(subject, f"See you {SLOT}")
        self.assertEqual(body, f"<p>Hi Asha Rao, Backend Engineer at {SLOT}: {URL}</p>")

    def test_a_template_without_the_slot_is_sent_exactly_as_written(self):
        # The organisation chose to leave the date out. It must not be quietly replaced by
        # the default, nor have a date added back.
        stored = {
            SCHEDULED: {
                "subject": "Interview for {{job_title}}",
                "body_html": "<p>Hi {{candidate_name}}, we will be in touch about timing.</p>",
                "version": 2,
            }
        }
        subject, body = render_template(SCHEDULED, stored, _variables())
        self.assertEqual(subject, "Interview for Backend Engineer")
        self.assertEqual(body, "<p>Hi Asha Rao, we will be in touch about timing.</p>")
        self.assertNotIn(SLOT, subject + body)
        self.assertNotIn(URL, body)

    def test_an_empty_stored_template_falls_back_to_the_default(self):
        # An empty email cannot be sent, so this is the one case that still falls back.
        stored = {SCHEDULED: {"subject": "Interview", "body_html": "   ", "version": 2}}
        with self.assertLogs("app.services.email_template_service", level="WARNING"):
            subject, body = render_template(SCHEDULED, stored, _variables())
        self.assertIn(SLOT, subject)
        self.assertIn(SLOT, body)

    def test_values_are_html_escaped(self):
        _, body = render_template(
            SCHEDULED,
            {},
            _variables(candidate_name="<script>alert(1)</script>", interview_url='https://a/b?x=1&y="2"'),
        )
        self.assertNotIn("<script>alert(1)</script>", body)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", body)
        self.assertNotIn('y="2"', body)

    def test_other_templates_are_unaffected(self):
        subject, _ = render_template("interview_invitation", {}, _variables())
        self.assertEqual(subject, "[Interview Invitation] Backend Engineer")


class SenderTests(unittest.IsolatedAsyncioTestCase):
    async def _send(self, **over):
        kwargs = dict(
            candidate_name="Asha Rao",
            candidate_email="asha@example.com",
            job_title="Backend Engineer",
            interview_url=URL,
            scheduled_at_label=SLOT,
        )
        kwargs.update(over)
        with patch.object(email_service, "_send_html_email_async", AsyncMock(return_value=True)) as send:
            sent = await email_service.send_scheduled_interview_notification(**kwargs)
        return sent, send

    async def test_without_templates_it_sends_the_default(self):
        sent, send = await self._send()
        self.assertTrue(sent)
        kwargs = send.await_args.kwargs
        self.assertEqual(kwargs["to_email"], "asha@example.com")
        self.assertEqual(kwargs["subject"], f"[Interview Scheduled] Backend Engineer — {SLOT}")
        self.assertIn(SLOT, kwargs["html_body"])
        self.assertIn(URL, kwargs["html_body"])

    async def test_an_organisations_template_and_company_name_are_used(self):
        templates = {
            SCHEDULED: {
                "subject": "{{company_name}}: {{job_title}} on {{scheduled_at}}",
                "body_html": "<p>{{candidate_name}} {{job_title}} {{scheduled_at}} {{interview_url}} {{company_name}}</p>",
                "version": 2,
            }
        }
        _, send = await self._send(templates=templates, company_name="Acme Corp")
        kwargs = send.await_args.kwargs
        self.assertEqual(kwargs["subject"], f"Acme Corp: Backend Engineer on {SLOT}")
        self.assertIn("Acme Corp", kwargs["html_body"])

    async def test_a_failed_send_reports_failure(self):
        with patch.object(email_service, "_send_html_email_async", AsyncMock(return_value=False)):
            sent = await email_service.send_scheduled_interview_notification(
                candidate_name="A",
                candidate_email="a@example.com",
                job_title="J",
                interview_url=URL,
                scheduled_at_label=SLOT,
            )
        self.assertFalse(sent)

    def test_the_hard_coded_builder_is_gone(self):
        # Two sources of truth for one email is how a template editor ends up ignored.
        self.assertFalse(hasattr(email_service, "_build_scheduled_interview_email_html"))


if __name__ == "__main__":
    unittest.main()
