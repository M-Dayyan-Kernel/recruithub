"""
Gmail API email transport — OAuth user credentials with gmail.send scope.

Tenant token loading stays here; OAuth/send transport is in GmailClient.
"""

from __future__ import annotations

import logging
import uuid
from email.mime.text import MIMEText

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
    if resend_configured():
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
    if resend_configured():
        hints.append(
            "Resend is configured — verify RESEND_FROM_EMAIL is a verified sender in Resend."
        )
    else:
        hints.append("Set RESEND_API_KEY in backend/.env, or")
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
