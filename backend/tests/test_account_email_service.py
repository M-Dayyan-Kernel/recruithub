"""Account/org lifecycle emails: content safety and failure behaviour."""

import unittest
from unittest.mock import AsyncMock, patch

from app.services import account_email_service as emails

HOSTILE_ORG = '<script>alert(1)</script> & "Co"'


class AccountEmailTests(unittest.IsolatedAsyncioTestCase):
    async def _capture(self, send, **kwargs):
        sender = AsyncMock(return_value=True)
        with patch.object(emails, "_send_html_email_async", sender):
            ok = await send(**kwargs)
        self.assertTrue(ok)
        return sender.await_args.kwargs

    async def test_user_supplied_names_are_escaped(self):
        sent = await self._capture(
            emails.send_org_onboarding_email,
            to_email="a@b.test",
            full_name='<b>Eve</b>',
            organization_name=HOSTILE_ORG,
            set_password_url="https://hr.test/reset-password?token=abc",
            expires_days=7,
        )
        html = sent["html_body"]
        self.assertNotIn("<script>", html)
        self.assertNotIn("<b>Eve</b>", html)
        self.assertIn("&lt;script&gt;", html)

    async def test_onboarding_email_carries_link_and_expiry_not_a_password(self):
        sent = await self._capture(
            emails.send_org_onboarding_email,
            to_email="a@b.test",
            full_name="Ada",
            organization_name="Acme",
            set_password_url="https://hr.test/reset-password?token=abc",
            expires_days=7,
        )
        self.assertEqual(sent["to_email"], "a@b.test")
        self.assertIn("https://hr.test/reset-password?token=abc", sent["html_body"])
        self.assertIn("7 days", sent["html_body"])
        self.assertNotIn("password:", sent["html_body"].lower())

    async def test_approved_email_links_to_login(self):
        sent = await self._capture(
            emails.send_org_approved_email,
            to_email="a@b.test",
            full_name="Ada",
            organization_name="Acme",
            login_url="https://hr.test/login",
        )
        self.assertIn("https://hr.test/login", sent["html_body"])
        self.assertIn("approved", sent["subject"])

    async def test_rejected_email_has_no_login_link(self):
        sent = await self._capture(
            emails.send_org_rejected_email,
            to_email="a@b.test",
            full_name="Ada",
            organization_name="Acme",
        )
        self.assertNotIn("href=", sent["html_body"])

    async def test_reset_email_states_expiry(self):
        sent = await self._capture(
            emails.send_password_reset_email,
            to_email="a@b.test",
            full_name="Ada",
            reset_url="https://hr.test/reset-password?token=xyz",
            expires_minutes=60,
        )
        self.assertIn("60 minutes", sent["html_body"])

    async def test_provider_failure_returns_false_and_never_raises(self):
        for outcome in (False, RuntimeError("smtp down")):
            sender = (
                AsyncMock(return_value=outcome)
                if outcome is False
                else AsyncMock(side_effect=outcome)
            )
            with patch.object(emails, "_send_html_email_async", sender):
                ok = await emails.send_org_rejected_email(
                    "a@b.test", full_name="Ada", organization_name="Acme"
                )
            self.assertFalse(ok)
