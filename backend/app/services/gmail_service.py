"""
Email transport. Platform mail goes over SMTP (SMTP_HOST), or the MOCK_EMAIL stub; every send
returns True/False and never raises. There is no fallback transport.

The Gmail API pieces below (send_via_gmail, get_tenant_gmail_token, the OAuth helpers and
GmailClient) are deliberately NOT part of that path. They are kept for a planned feature: letting
an organization's admin send mail from their own Gmail account instead of the shared SMTP
mailbox. Nothing calls them yet, and no screen sets the tenant token (system_settings.integrations).
"""

from __future__ import annotations

import html as html_lib
import logging
import re
import smtplib
import ssl
import uuid
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid

from sqlalchemy.ext.asyncio import AsyncSession

from app.clients import gmail_client, mocks
from app.clients.gmail_client import GmailNotConfiguredError
from app.core.settings import settings as env_settings

logger = logging.getLogger(__name__)


def run_interactive_oauth():
    return gmail_client().run_interactive_oauth()


def load_credentials():
    return gmail_client().load_credentials()


def load_credentials_from_integration(token_json: str | dict | None):
    return gmail_client().load_credentials_from_integration(token_json)


SMTP_TIMEOUT_SECONDS = 30


def smtp_configured() -> bool:
    return bool((env_settings.SMTP_HOST or "").strip())


def _clean_header(value: str) -> str:
    # A header is one line: a newline in a subject or address would let it inject headers.
    return re.sub(r"[\r\n]+", " ", value or "").strip()


def _html_to_text(html_body: str) -> str:
    """A readable plain-text twin for the HTML part (mail without one scores worse as spam)."""
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", html_body)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</h[1-6]>|</li>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    text = html_lib.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()


def _send_via_smtp(to_email: str, subject: str, body: str, *, html: bool, from_name: str | None = None) -> bool:
    host = (env_settings.SMTP_HOST or "").strip()
    if not host:
        return False
    username = (env_settings.SMTP_USERNAME or "").strip()
    sender = _clean_header(username)
    if not sender:
        logger.error("SMTP is configured but SMTP_USERNAME is empty, so there is no sender address")
        return False

    if html:
        message = MIMEMultipart("alternative")
        message.attach(MIMEText(_html_to_text(body), "plain", "utf-8"))
        message.attach(MIMEText(body, "html", "utf-8"))
    else:
        message = MIMEText(body, "plain", "utf-8")
    # The display name is the organization's, so each tenant's candidates see their own name
    # on mail that all leaves through one mailbox. Only the label: the address is the login.
    message["From"] = formataddr((_clean_header(from_name or ""), sender))
    message["To"] = _clean_header(to_email)
    message["Subject"] = _clean_header(subject)
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain=sender.rsplit("@", 1)[-1] or None)

    port = int(env_settings.SMTP_PORT)
    try:
        context = ssl.create_default_context()
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=SMTP_TIMEOUT_SECONDS, context=context)
        else:
            server = smtplib.SMTP(host, port, timeout=SMTP_TIMEOUT_SECONDS)
        with server:
            server.ehlo()
            if port != 465 and server.has_extn("starttls"):
                server.starttls(context=context)
                server.ehlo()
            server.login(username, env_settings.SMTP_PASSWORD or "")
            server.send_message(message, from_addr=sender, to_addrs=[to_email])
        logger.info("SMTP email sent to %s via %s:%s", to_email, host, port)
        return True
    except Exception as exc:  # noqa: BLE001 - mail must never raise into the caller
        # The message is logged, the password never is.
        logger.error("SMTP send failed for %s via %s:%s: %s", to_email, host, port, exc)
        return False


async def get_tenant_gmail_token(
    db: AsyncSession,
    tenant_id: uuid.UUID | None,
) -> str | None:
    if not tenant_id:
        return None
    from app.services.tenant_integrations_service import load_tenant_integrations

    try:
        integrations = await load_tenant_integrations(db, tenant_id)
    except Exception:
        logger.exception("Failed to load tenant integrations for tenant=%s", tenant_id)
        return None
    token = (integrations.gmail_token_json or "").strip()
    return token or None


def email_transport_hint() -> str:
    if mocks.mock_email_enabled():
        return "Email mock mode is enabled (MOCK_EMAIL=true)."
    if not smtp_configured():
        return (
            "SMTP is not configured: set SMTP_HOST, SMTP_USERNAME and SMTP_PASSWORD in the "
            "backend env. For local dev without sending mail, set MOCK_EMAIL=true."
        )
    return (
        "Check SMTP_HOST, SMTP_PORT, SMTP_USERNAME and SMTP_PASSWORD (Gmail needs an app "
        "password). The API log says why the last send failed."
    )


def send_via_gmail(
    to_email: str,
    subject: str,
    body: str,
    *,
    html: bool,
    token_json: str | dict | None = None,
) -> bool:
    """Send as the Gmail account behind `token_json` (the tenant admin's). Not wired in yet."""
    try:
        message = MIMEText(body, "html" if html else "plain", "utf-8")
        message_id = gmail_client().send_mime_message(
            to_email, subject, message, token_json=token_json
        )
        logger.info("Gmail email sent to %s (message_id=%s)", to_email, message_id)
        return True
    except Exception as exc:  # noqa: BLE001 - mail must never raise into the caller
        logger.error("Failed to send Gmail email to %s: %s", to_email, exc)
        return False


def _send(to_email: str, subject: str, body: str, *, html: bool, from_name: str | None) -> bool:
    if mocks.mock_email_enabled():
        return mocks.mock_email_send(to_email, subject)
    if not smtp_configured():
        logger.error("Cannot send email to %s: SMTP_HOST is not set", to_email)
        return False
    return _send_via_smtp(to_email, subject, body, html=html, from_name=from_name)


def send_html_email(to_email: str, subject: str, html_body: str, *, from_name: str | None = None) -> bool:
    """`from_name` is the display name on the mail (the organization's name)."""
    return _send(to_email, subject, html_body, html=True, from_name=from_name)


def send_plain_email(to_email: str, subject: str, body: str, *, from_name: str | None = None) -> bool:
    return _send(to_email, subject, body, html=False, from_name=from_name)
