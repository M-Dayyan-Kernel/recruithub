"""
Gmail API email transport — OAuth user credentials with gmail.send scope.
"""

from __future__ import annotations

import base64
import json
import logging
import uuid
from email.mime.text import MIMEText
from pathlib import Path

import httpx
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.settings import settings as env_settings

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


class GmailNotConfiguredError(RuntimeError):
    """Raised when Gmail OAuth token is missing and interactive auth is not available."""


def _backend_dir() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _parse_env_json(raw: str | None) -> dict | None:
    if not raw or not raw.strip():
        return None
    return json.loads(raw.strip())


def _ensure_valid_credentials(creds: Credentials) -> Credentials:
    if creds.valid:
        return creds
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        return creds
    raise GmailNotConfiguredError(
        "Gmail token is invalid or expired. Re-run `python -m scripts.gmail_auth` "
        "or update GMAIL_TOKEN_JSON."
    )


def _persist_refreshed_token(creds: Credentials, token_path: Path) -> None:
    try:
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(creds.to_json(), encoding="utf-8")
    except OSError:
        logger.debug("Could not persist refreshed Gmail token to %s", token_path)


def _resolve_path(path_str: str) -> Path:
    """Resolve a Gmail OAuth file path (credentials.json / token.json).

    Relative paths are searched under cwd, backend/, then repo root so files
  placed next to quickstart-style layouts still work when uvicorn runs from backend/.
    """
    path = Path(path_str).expanduser()
    if path.is_absolute():
        return path.resolve()

    backend_dir = _backend_dir()
    search_roots = [Path.cwd(), backend_dir, backend_dir.parent]

    for root in search_roots:
        candidate = (root / path).resolve()
        if candidate.exists():
            return candidate

    # If the sibling OAuth file exists, keep both files in the same directory.
    path_name = path.name
    creds_name = Path(config.GMAIL_CREDENTIALS_PATH).name
    token_name = Path(config.GMAIL_TOKEN_PATH).name
    sibling_name = token_name if path_name == creds_name else creds_name
    for root in search_roots:
        if (root / sibling_name).exists():
            return (root / path).resolve()

    return (backend_dir / path).resolve()


def _load_client_config() -> dict:
    env_config = _parse_env_json(env_settings.GMAIL_CREDENTIALS_JSON)
    if env_config is not None:
        return env_config

    creds_path = _resolve_path(config.GMAIL_CREDENTIALS_PATH)
    if not creds_path.exists():
        raise FileNotFoundError(
            f"Gmail OAuth client secrets not found at {creds_path}. "
            "Set GMAIL_CREDENTIALS_JSON or download credentials.json from Google Cloud Console."
        )
    return json.loads(creds_path.read_text(encoding="utf-8"))


def load_credentials() -> Credentials:
    token_info = _parse_env_json(env_settings.GMAIL_TOKEN_JSON)
    if token_info is not None:
        return _ensure_valid_credentials(
            Credentials.from_authorized_user_info(token_info, SCOPES)
        )

    creds_path = _resolve_path(config.GMAIL_CREDENTIALS_PATH)
    token_path = _resolve_path(config.GMAIL_TOKEN_PATH)

    creds = None
    if token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
        except ValueError:
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            _persist_refreshed_token(creds, token_path)
        else:
            raise GmailNotConfiguredError(
                "Gmail is not authenticated. Set GMAIL_TOKEN_JSON in .env, or place "
                "credentials.json and run `python -m scripts.gmail_auth` from the backend "
                f"directory (credentials: {creds_path}, token: {token_path})."
            )

    return creds


def run_interactive_oauth() -> Credentials:
    """One-time desktop OAuth flow; persists token.json. Dev/bootstrap only."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    client_config = _load_client_config()
    token_path = _resolve_path(config.GMAIL_TOKEN_PATH)

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=0)
    token_text = creds.to_json()
    _persist_refreshed_token(creds, token_path)
    if not (env_settings.GMAIL_TOKEN_JSON or "").strip():
        print(
            "Tip: copy the token into .env as GMAIL_TOKEN_JSON "
            "(single-line JSON, wrap in single quotes if needed)."
        )
        print(token_text)
    return creds


def load_credentials_from_integration(token_json: str | dict | None) -> Credentials:
    """Load Gmail credentials from per-tenant encrypted integration JSON."""
    if not token_json:
        return load_credentials()

    if isinstance(token_json, str):
        info = json.loads(token_json)
    else:
        info = token_json
    return _ensure_valid_credentials(Credentials.from_authorized_user_info(info, SCOPES))


def _send_mime_message(
    to_email: str,
    subject: str,
    mime_message: MIMEText,
    *,
    token_json: str | dict | None = None,
) -> str:
    mime_message["to"] = to_email
    mime_message["subject"] = subject

    creds = load_credentials_from_integration(token_json)
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    raw = base64.urlsafe_b64encode(mime_message.as_bytes()).decode("utf-8")
    result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
    return str(result.get("id", ""))


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


def resend_configured() -> bool:
    return bool((env_settings.RESEND_API_KEY or "").strip())


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
    from app.services.mock_external import mock_email_enabled

    if mock_email_enabled():
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
    from app.services.mock_external import mock_email_enabled

    if mock_email_enabled():
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
    from app.services.mock_external import mock_email_enabled, mock_email_send

    if mock_email_enabled():
        return mock_email_send(to_email, subject)

    if resend_configured():
        if _send_via_resend(to_email, subject, html_body):
            return True
        logger.warning("Resend send failed for %s — falling back to Gmail", to_email)

    try:
        message = MIMEText(html_body, "html", "utf-8")
        message_id = _send_mime_message(
            to_email, subject, message, token_json=gmail_token_json
        )
        logger.info("Gmail HTML email sent to %s (message_id=%s)", to_email, message_id)
        return True
    except Exception as exc:
        logger.error("Failed to send Gmail HTML email to %s: %s", to_email, exc)
        return False


def send_plain_email(to_email: str, subject: str, body: str) -> bool:
    from app.services.mock_external import mock_email_enabled, mock_email_send

    if mock_email_enabled():
        return mock_email_send(to_email, subject)

    if resend_configured():
        html_body = f"<pre>{body}</pre>"
        if _send_via_resend(to_email, subject, html_body):
            return True
        logger.warning("Resend send failed for %s — falling back to Gmail", to_email)

    try:
        message = MIMEText(body, "plain", "utf-8")
        message_id = _send_mime_message(to_email, subject, message)
        logger.info("Gmail plain email sent to %s (message_id=%s)", to_email, message_id)
        return True
    except Exception as exc:
        logger.error("Failed to send Gmail plain email to %s: %s", to_email, exc)
        return False
