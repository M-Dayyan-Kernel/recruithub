"""
Email transport. Tried in order: mock (MOCK_EMAIL), SMTP (when SMTP_HOST is set), Resend,
then the Gmail API (OAuth user credentials with gmail.send scope). Each falls back to the next
on failure; every send returns True/False and never raises.

Tenant token loading stays here; OAuth/send transport is in GmailClient.
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

import httpx
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


def _smtp_sender() -> str:
    return _clean_header(env_settings.SMTP_FROM_EMAIL or env_settings.SMTP_USERNAME)


def _send_via_smtp(to_email: str, subject: str, body: str, *, html: bool) -> bool:
    host = (env_settings.SMTP_HOST or "").strip()
    if not host:
        return False
    sender = _smtp_sender()
    if not sender:
        logger.error("SMTP is configured but there is no sender: set SMTP_FROM_EMAIL or SMTP_USERNAME")
        return False

    if html:
        message = MIMEMultipart("alternative")
        message.attach(MIMEText(_html_to_text(body), "plain", "utf-8"))
        message.attach(MIMEText(body, "html", "utf-8"))
    else:
        message = MIMEText(body, "plain", "utf-8")
    message["From"] = formataddr((_clean_header(env_settings.SMTP_FROM_NAME), sender))
    message["To"] = _clean_header(to_email)
    message["Subject"] = _clean_header(subject)
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain=sender.rsplit("@", 1)[-1] or None)

    port = int(env_settings.SMTP_PORT)
    username = (env_settings.SMTP_USERNAME or "").strip()
    try:
        if env_settings.SMTP_USE_SSL:
            server = smtplib.SMTP_SSL(host, port, timeout=SMTP_TIMEOUT_SECONDS, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(host, port, timeout=SMTP_TIMEOUT_SECONDS)
        with server:
            server.ehlo()
            if env_settings.SMTP_USE_TLS and not env_settings.SMTP_USE_SSL:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            if username:
                server.login(username, env_settings.SMTP_PASSWORD or "")
            server.send_message(message, from_addr=sender, to_addrs=[to_email])
        logger.info("SMTP email sent to %s via %s:%s", to_email, host, port)
        return True
    except Exception as exc:  # noqa: BLE001 - mail must never raise into the caller
        # The message is logged, the password never is.
        logger.error("SMTP send failed for %s via %s:%s: %s", to_email, host, port, exc)
        return False


def resend_configured() -> bool:
    return bool((env_settings.RESEND_API_KEY or "").strip())


def _send_via_resend(to_email: str, subject: str, html_body: str) -> bool:
    api_key = (env_settings.RESEND_API_KEY or "").strip()
    if not api_key:
        return False
    from_email = (env_settings.RESEND_FROM_EMAIL or "onboarding@resend.dev").strip()
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": from_email,
                "to": [to_email],
                "subject": subject,
                "html": html_body,
            },
            timeout=30.0,
        )
        if response.status_code in (200, 201):
            logger.info("Resend email sent to %s (id=%s)", to_email, response.json().get("id"))
            return True
        logger.error(
            "Resend API error for %s: status=%s body=%s",
            to_email,
            response.status_code,
            response.text,
        )
        return False
    except Exception as exc:
        logger.error("Resend send failed for %s: %s", to_email, exc)
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


def gmail_configured(gmail_token_json: str | dict | None = None) -> bool:
    if mocks.mock_email_enabled():
        return True
    if smtp_configured() or resend_configured():
        return True
    try:
        load_credentials_from_integration(gmail_token_json)
        return True
    except GmailNotConfiguredError:
        return False
    except Exception:
        return False


def email_transport_hint() -> str:
    if mocks.mock_email_enabled():
        return "Email mock mode is enabled (MOCK_EMAIL=true)."
    hints: list[str] = []
    if smtp_configured():
        hints.append(
            "SMTP is configured — check SMTP_HOST, SMTP_PORT, SMTP_USERNAME and SMTP_PASSWORD "
            "(Gmail needs an app password), and that SMTP_FROM_EMAIL is the signed-in mailbox "
            "or a verified alias. The API log says why the last send failed."
        )
    if resend_configured():
        hints.append(
            "Resend is configured — verify RESEND_FROM_EMAIL is a verified sender in Resend."
        )
    else:
        hints.append("Set SMTP_HOST (+ SMTP_USERNAME, SMTP_PASSWORD) or RESEND_API_KEY in backend/.env, or")
    hints.append(
        "configure Gmail OAuth (GMAIL_TOKEN_JSON in .env, or `python -m scripts.gmail_auth`), "
        "or add a tenant Gmail token under Settings → Integrations."
    )
    hints.append("For local dev without sending mail, set MOCK_EMAIL=true.")
    return " ".join(hints)


def send_html_email(
    to_email: str,
    subject: str,
    html_body: str,
    *,
    gmail_token_json: str | dict | None = None,
) -> bool:
    if mocks.mock_email_enabled():
        return mocks.mock_email_send(to_email, subject)

    if smtp_configured():
        if _send_via_smtp(to_email, subject, html_body, html=True):
            return True
        logger.warning("SMTP send failed for %s — falling back", to_email)

    if resend_configured():
        if _send_via_resend(to_email, subject, html_body):
            return True
        logger.warning("Resend send failed for %s — falling back to Gmail", to_email)

    try:
        message = MIMEText(html_body, "html", "utf-8")
        message_id = gmail_client().send_mime_message(
            to_email, subject, message, token_json=gmail_token_json
        )
        logger.info("Gmail HTML email sent to %s (message_id=%s)", to_email, message_id)
        return True
    except Exception as exc:
        logger.error("Failed to send Gmail HTML email to %s: %s", to_email, exc)
        return False


def send_plain_email(to_email: str, subject: str, body: str) -> bool:
    if mocks.mock_email_enabled():
        return mocks.mock_email_send(to_email, subject)

    if smtp_configured():
        if _send_via_smtp(to_email, subject, body, html=False):
            return True
        logger.warning("SMTP send failed for %s — falling back", to_email)

    if resend_configured():
        html_body = f"<pre>{body}</pre>"
        if _send_via_resend(to_email, subject, html_body):
            return True
        logger.warning("Resend send failed for %s — falling back to Gmail", to_email)

    try:
        message = MIMEText(body, "plain", "utf-8")
        message_id = gmail_client().send_mime_message(to_email, subject, message)
        logger.info("Gmail plain email sent to %s (message_id=%s)", to_email, message_id)
        return True
    except Exception as exc:
        logger.error("Failed to send Gmail plain email to %s: %s", to_email, exc)
        return False
