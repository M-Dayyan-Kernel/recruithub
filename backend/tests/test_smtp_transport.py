"""SMTP transport: connection modes, message shape, and where it sits among the transports."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import gmail_service as gs


def _env(**over):
    base = dict(
        SMTP_HOST="smtp.example.com", SMTP_PORT=587, SMTP_USERNAME="hr@example.com",
        SMTP_PASSWORD="app-password", RESEND_API_KEY="", RESEND_FROM_EMAIL="x@y.z",
    )
    base.update(over)
    return SimpleNamespace(**base)


def _server(starttls=True):
    server = MagicMock()
    server.__enter__.return_value = server
    server.has_extn.side_effect = lambda name: starttls and name == "starttls"
    return server


class SmtpSendTests(unittest.TestCase):
    def _send(self, html=True, body="<p>Hello <b>Asha</b></p><p>Next</p>", from_name=None, starttls=True, **env):
        server = _server(starttls)
        with patch.object(gs, "env_settings", _env(**env)), patch.object(
            gs.smtplib, "SMTP", return_value=server
        ) as smtp, patch.object(gs.smtplib, "SMTP_SSL", return_value=server) as smtp_ssl:
            ok = gs._send_via_smtp("asha@example.com", "Interview", body, html=html, from_name=from_name)
        return ok, server, smtp, smtp_ssl

    def test_starttls_then_login_then_send(self):
        ok, server, smtp, smtp_ssl = self._send()
        self.assertTrue(ok)
        smtp.assert_called_once()
        self.assertEqual(smtp.call_args.args[:2], ("smtp.example.com", 587))
        self.assertEqual(smtp.call_args.kwargs["timeout"], gs.SMTP_TIMEOUT_SECONDS)
        smtp_ssl.assert_not_called()
        names = [c[0] for c in server.method_calls]
        self.assertLess(names.index("starttls"), names.index("login"))
        self.assertLess(names.index("login"), names.index("send_message"))
        server.login.assert_called_once_with("hr@example.com", "app-password")

    def test_port_465_is_encrypted_from_the_start_and_never_starttls(self):
        ok, server, smtp, smtp_ssl = self._send(SMTP_PORT=465)
        self.assertTrue(ok)
        smtp_ssl.assert_called_once()
        smtp.assert_not_called()
        server.starttls.assert_not_called()

    def test_starttls_only_when_the_server_offers_it(self):
        ok, server, *_ = self._send(starttls=False)
        self.assertTrue(ok)
        server.starttls.assert_not_called()
        server.login.assert_called_once()

    def test_message_headers_and_parts(self):
        ok, server, *_ = self._send(from_name="Webknot Technologies")
        msg = server.send_message.call_args.args[0]
        self.assertEqual(msg["From"], "Webknot Technologies <hr@example.com>")
        self.assertEqual(msg["To"], "asha@example.com")
        self.assertEqual(msg["Subject"], "Interview")
        self.assertTrue(msg["Message-ID"].endswith("@example.com>"))
        self.assertTrue(msg["Date"])
        self.assertEqual([p.get_content_type() for p in msg.get_payload()], ["text/plain", "text/html"])
        self.assertIn("Hello Asha", msg.get_payload()[0].get_payload(decode=True).decode())
        self.assertEqual(server.send_message.call_args.kwargs, {"from_addr": "hr@example.com", "to_addrs": ["asha@example.com"]})

    def test_the_sender_is_the_username_and_a_missing_name_is_just_the_address(self):
        ok, server, *_ = self._send()
        msg = server.send_message.call_args.args[0]
        self.assertEqual(msg["From"], "hr@example.com")
        self.assertEqual(server.send_message.call_args.kwargs["from_addr"], "hr@example.com")

    def test_an_organization_name_with_odd_characters_stays_one_valid_header(self):
        ok, server, *_ = self._send(from_name='Acme, "R&D" Ltd\nBcc: evil@x.com')
        msg = server.send_message.call_args.args[0]
        self.assertNotIn("\n", msg["From"])
        self.assertIsNone(msg["Bcc"])
        self.assertIn("<hr@example.com>", msg["From"])

    def test_plain_body_is_one_text_part(self):
        ok, server, *_ = self._send(html=False, body="just text")
        msg = server.send_message.call_args.args[0]
        self.assertEqual(msg.get_content_type(), "text/plain")

    def test_newlines_cannot_inject_headers(self):
        server = _server()
        with patch.object(gs, "env_settings", _env()), patch.object(gs.smtplib, "SMTP", return_value=server):
            gs._send_via_smtp("a@b.com\nBcc: x@y.z", "Hi\r\nBcc: evil@x.com", "<p>x</p>", html=True)
        msg = server.send_message.call_args.args[0]
        self.assertNotIn("\n", msg["Subject"])
        self.assertNotIn("\n", msg["To"])
        self.assertIsNone(msg["Bcc"])

    def test_failure_returns_false_and_never_logs_the_password(self):
        server = _server()
        server.login.side_effect = RuntimeError("535 auth failed")
        with patch.object(gs, "env_settings", _env()), patch.object(
            gs.smtplib, "SMTP", return_value=server
        ), self.assertLogs(gs.logger, "ERROR") as logs:
            ok = gs._send_via_smtp("a@b.com", "s", "<p>x</p>", html=True)
        self.assertFalse(ok)
        self.assertIn("535 auth failed", logs.output[0])
        self.assertNotIn("app-password", logs.output[0])

    def test_connection_error_returns_false(self):
        with patch.object(gs, "env_settings", _env()), patch.object(gs.smtplib, "SMTP", side_effect=OSError("down")):
            self.assertFalse(gs._send_via_smtp("a@b.com", "s", "x", html=False))

    def test_not_configured_or_no_sender(self):
        with patch.object(gs, "env_settings", _env(SMTP_HOST="")):
            self.assertFalse(gs.smtp_configured())
            self.assertFalse(gs._send_via_smtp("a@b.com", "s", "x", html=False))
        with patch.object(gs, "env_settings", _env(SMTP_USERNAME="")):
            self.assertFalse(gs._send_via_smtp("a@b.com", "s", "x", html=False))


class TransportOrderTests(unittest.TestCase):
    def _run(self, *, smtp_ok, resend_key="", html=True):
        calls = []
        with patch.object(gs, "env_settings", _env(RESEND_API_KEY=resend_key)), patch.object(
            gs.mocks, "mock_email_enabled", return_value=False
        ), patch.object(gs, "_send_via_smtp", side_effect=lambda *a, **k: calls.append("smtp") or smtp_ok), patch.object(
            gs, "_send_via_resend", side_effect=lambda *a, **k: calls.append("resend") or True
        ), patch.object(gs, "gmail_client") as gmail:
            gmail.return_value.send_mime_message.side_effect = lambda *a, **k: calls.append("gmail") or "id"
            out = gs.send_html_email("a@b.com", "s", "<p>x</p>") if html else gs.send_plain_email("a@b.com", "s", "x")
        return out, calls

    def test_smtp_goes_first_and_stops_on_success(self):
        for html in (True, False):
            out, calls = self._run(smtp_ok=True, resend_key="k", html=html)
            self.assertEqual((out, calls), (True, ["smtp"]))

    def test_the_organization_name_reaches_smtp(self):
        seen = {}
        with patch.object(gs, "env_settings", _env()), patch.object(gs.mocks, "mock_email_enabled", return_value=False), patch.object(
            gs, "_send_via_smtp", side_effect=lambda *a, **k: seen.update(k) or True
        ):
            gs.send_html_email("a@b.com", "s", "<p>x</p>", from_name="Webknot Technologies")
            self.assertEqual(seen["from_name"], "Webknot Technologies")
            gs.send_plain_email("a@b.com", "s", "x", from_name="Acme")
            self.assertEqual(seen["from_name"], "Acme")

    def test_a_failed_smtp_falls_back_to_resend_then_gmail(self):
        self.assertEqual(self._run(smtp_ok=False, resend_key="k"), (True, ["smtp", "resend"]))
        self.assertEqual(self._run(smtp_ok=False), (True, ["smtp", "gmail"]))

    def test_mock_mode_sends_nothing(self):
        with patch.object(gs, "env_settings", _env()), patch.object(gs.mocks, "mock_email_enabled", return_value=True), patch.object(
            gs.mocks, "mock_email_send", return_value=True
        ), patch.object(gs, "_send_via_smtp") as smtp:
            self.assertTrue(gs.send_html_email("a@b.com", "s", "x"))
        smtp.assert_not_called()

    def test_smtp_alone_counts_as_configured(self):
        with patch.object(gs, "env_settings", _env()), patch.object(gs.mocks, "mock_email_enabled", return_value=False):
            self.assertTrue(gs.gmail_configured())
            self.assertIn("SMTP is configured", gs.email_transport_hint())

    def test_html_to_text(self):
        text = gs._html_to_text("<style>p{}</style><h1>Hi</h1><p>A &amp; B<br>C</p><script>x()</script>")
        self.assertEqual(text, "Hi\nA & B\nC")


if __name__ == "__main__":
    unittest.main()
