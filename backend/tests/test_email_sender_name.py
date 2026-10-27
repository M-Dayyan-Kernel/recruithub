"""Every email the app sends carries the organization's name as the sender name."""

import unittest
from unittest.mock import patch

from app.services import email_service as es
from app.services.email_template_service import _DEFAULT_TEMPLATES


class SenderNameTests(unittest.IsolatedAsyncioTestCase):
    async def _capture(self, coro_fn):
        seen = {}

        async def fake(**kwargs):
            seen.update(kwargs)
            return True

        with patch.object(es, "_send_html_email_async", fake):
            ok = await coro_fn()
        self.assertTrue(ok)
        return seen

    async def test_candidate_emails_use_the_company_name(self):
        common = dict(company_name="Webknot Technologies")
        cases = {
            "interview link": lambda: es.send_interview_link("A", "a@x.io", "Eng", "https://x/i", **common),
            "scheduled": lambda: es.send_scheduled_interview_notification(
                "A", "a@x.io", "Eng", "https://x/i", "Mon 3pm", **common
            ),
            "failed attempt": lambda: es.send_failed_screening_attempt_email(
                "A", "a@x.io", "Eng", "+91 98", templates=_DEFAULT_TEMPLATES, **common
            ),
            "rejection": lambda: es.send_rejection_email("A", "a@x.io", "Eng", **common),
        }
        for name, call in cases.items():
            with self.subTest(name):
                try:
                    seen = await self._capture(call)
                except TypeError as exc:  # signature differs: surface which case
                    self.fail(f"{name}: {exc}")
                self.assertEqual(seen["from_name"], "Webknot Technologies")

    async def test_org_invite_uses_the_organization_name(self):
        seen = await self._capture(
            lambda: es.send_org_invite_email("a@x.io", organization_name="Acme Ltd", role="hr", invite_url="https://x/inv")
        )
        self.assertEqual(seen["from_name"], "Acme Ltd")


if __name__ == "__main__":
    unittest.main()
