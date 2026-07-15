"""
Gmail API email transport — OAuth user credentials with gmail.send scope.

Supports per-tenant OAuth JSON from TenantIntegrations, with file-based
platform fallback for local bootstrap scripts.
"""

from __future__ import annotations

import base64
import logging
import tempfile
from email.mime.text import MIMEText
from pathlib import Path
from typing import TYPE_CHECKING, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.core.config import settings

if TYPE_CHECKING:
    from app.services.tenant_integrations_service import TenantIntegrations

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


class GmailNotConfiguredError(RuntimeError):
    """Raised when Gmail OAuth token is missing and interactive auth is not available."""


def _backend_dir() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _resolve_path(path_str: str) -> Path:
    """Resolve a Gmail OAuth file path (credentials.json / token.json)."""
    path = Path(path_str).expanduser()
    if path.is_absolute():
        return path.resolve()

    backend_dir = _backend_dir()
    search_roots = [Path.cwd(), backend_dir, backend_dir.parent]

    for root in search_roots:
        candidate = (root / path).resolve()
        if candidate.exists():
            return candidate

    path_name = path.name
    creds_name = Path(settings.GMAIL_CREDENTIALS_PATH).name
    token_name = Path(settings.GMAIL_TOKEN_PATH).name
    sibling_name = token_name if path_name == creds_name else creds_name
    for root in search_roots:
        if (root / sibling_name).exists():
            return (root / path).resolve()

    return (backend_dir / path).resolve()


def load_credentials_from_json(
    credentials_json: str,
    token_json: str,
) -> Credentials:
    if not token_json.strip():
        raise GmailNotConfiguredError(
            "Gmail token JSON is missing for this organization. "
            "Paste token.json under Settings → Integrations."
        )

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tf:
        tf.write(token_json)
        token_path = Path(tf.name)

    try:
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
        except ValueError as exc:
            raise GmailNotConfiguredError(
                "Gmail token JSON is invalid for this organization."
            ) from exc

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                if credentials_json.strip():
                    # Refresh does not need client secrets file when refresh_token present
                    creds.refresh(Request())
                else:
                    creds.refresh(Request())
            else:
                raise GmailNotConfiguredError(
                    "Gmail OAuth token expired and cannot be refreshed. "
                    "Re-authenticate and update Settings → Integrations."
                )
        return creds
    finally:
        try:
            token_path.unlink(missing_ok=True)
        except OSError:
            pass


def load_credentials() -> Credentials:
    """Platform file-based credentials (scripts / legacy bootstrap only)."""
    creds_path = _resolve_path(settings.GMAIL_CREDENTIALS_PATH)
    token_path = _resolve_path(settings.GMAIL_TOKEN_PATH)

    creds = None
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
        except ValueError:
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            token_path.write_text(creds.to_json(), encoding="utf-8")
        else:
            raise GmailNotConfiguredError(
                "Gmail is not authenticated. Place credentials.json and run "
                "`python -m scripts.gmail_auth` from the backend directory "
                f"(credentials: {creds_path}, token: {token_path})."
            )

    return creds


def load_credentials_for_integrations(integrations: Optional["TenantIntegrations"]) -> Credentials:
    if integrations and (
        integrations.gmail_token_json.strip() or integrations.gmail_credentials_json.strip()
    ):
        return load_credentials_from_json(
            integrations.gmail_credentials_json,
            integrations.gmail_token_json,
        )
    return load_credentials()


def run_interactive_oauth() -> Credentials:
    """One-time desktop OAuth flow; persists token.json. Dev/bootstrap only."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds_path = _resolve_path(settings.GMAIL_CREDENTIALS_PATH)
    token_path = _resolve_path(settings.GMAIL_TOKEN_PATH)

    if not creds_path.exists():
        raise FileNotFoundError(
            f"Gmail OAuth client secrets not found at {creds_path}. "
            "Download credentials.json from Google Cloud Console."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
    creds = flow.run_local_server(port=0)
    token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def _send_mime_message(
    to_email: str,
    subject: str,
    mime_message: MIMEText,
    *,
    integrations: Optional["TenantIntegrations"] = None,
) -> str:
    mime_message["to"] = to_email
    mime_message["subject"] = subject

    creds = load_credentials_for_integrations(integrations)
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    raw = base64.urlsafe_b64encode(mime_message.as_bytes()).decode("utf-8")
    result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
    return str(result.get("id", ""))


def send_html_email(
    to_email: str,
    subject: str,
    html_body: str,
    *,
    integrations: Optional["TenantIntegrations"] = None,
) -> bool:
    from app.services.mock_external import mock_email_enabled, mock_email_send

    if mock_email_enabled():
        return mock_email_send(to_email, subject)

    try:
        message = MIMEText(html_body, "html", "utf-8")
        message_id = _send_mime_message(
            to_email, subject, message, integrations=integrations
        )
        logger.info("Gmail HTML email sent to %s (message_id=%s)", to_email, message_id)
        return True
    except Exception as exc:
        logger.error("Failed to send Gmail HTML email to %s: %s", to_email, exc)
        return False


def send_plain_email(
    to_email: str,
    subject: str,
    body: str,
    *,
    integrations: Optional["TenantIntegrations"] = None,
) -> bool:
    from app.services.mock_external import mock_email_enabled, mock_email_send

    if mock_email_enabled():
        return mock_email_send(to_email, subject)

    try:
        message = MIMEText(body, "plain", "utf-8")
        message_id = _send_mime_message(
            to_email, subject, message, integrations=integrations
        )
        logger.info("Gmail plain email sent to %s (message_id=%s)", to_email, message_id)
        return True
    except Exception as exc:
        logger.error("Failed to send Gmail plain email to %s: %s", to_email, exc)
        return False
