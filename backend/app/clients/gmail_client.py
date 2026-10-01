"""Gmail API client — OAuth credentials and message send."""

from __future__ import annotations

import base64
import json
import logging
from email.mime.text import MIMEText
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.core.config_loader import config
from app.core.settings import settings as env_settings

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


class GmailNotConfiguredError(RuntimeError):
    """Raised when Gmail OAuth token is missing and interactive auth is not available."""


class GmailClient:
    """Gmail OAuth transport for sending messages."""

    def _backend_dir(self) -> Path:
        return Path(__file__).resolve().parent.parent.parent

    def _parse_env_json(self, raw: str | None) -> dict | None:
        if not raw or not raw.strip():
            return None
        return json.loads(raw.strip())

    def _ensure_valid_credentials(self, creds: Credentials) -> Credentials:
        if creds.valid:
            return creds
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            return creds
        raise GmailNotConfiguredError(
            "Gmail token is invalid or expired. Re-run `python -m scripts.gmail_auth` "
            "or update GMAIL_TOKEN_JSON."
        )

    def _persist_refreshed_token(self, creds: Credentials, token_path: Path) -> None:
        try:
            token_path.parent.mkdir(parents=True, exist_ok=True)
            token_path.write_text(creds.to_json(), encoding="utf-8")
        except OSError:
            logger.debug("Could not persist refreshed Gmail token to %s", token_path)

    def _resolve_path(self, path_str: str) -> Path:
        path = Path(path_str).expanduser()
        if path.is_absolute():
            return path.resolve()

        backend_dir = self._backend_dir()
        search_roots = [Path.cwd(), backend_dir, backend_dir.parent]

        for root in search_roots:
            candidate = (root / path).resolve()
            if candidate.exists():
                return candidate

        path_name = path.name
        creds_name = Path(config.GMAIL_CREDENTIALS_PATH).name
        token_name = Path(config.GMAIL_TOKEN_PATH).name
        sibling_name = token_name if path_name == creds_name else creds_name
        for root in search_roots:
            if (root / sibling_name).exists():
                return (root / path).resolve()

        return (backend_dir / path).resolve()

    def _load_client_config(self) -> dict:
        env_config = self._parse_env_json(env_settings.GMAIL_CREDENTIALS_JSON)
        if env_config is not None:
            return env_config

        creds_path = self._resolve_path(config.GMAIL_CREDENTIALS_PATH)
        if not creds_path.exists():
            raise FileNotFoundError(
                f"Gmail OAuth client secrets not found at {creds_path}. "
                "Set GMAIL_CREDENTIALS_JSON or download credentials.json from Google Cloud Console."
            )
        return json.loads(creds_path.read_text(encoding="utf-8"))

    def load_credentials(self) -> Credentials:
        token_info = self._parse_env_json(env_settings.GMAIL_TOKEN_JSON)
        if token_info is not None:
            return self._ensure_valid_credentials(
                Credentials.from_authorized_user_info(token_info, SCOPES)
            )

        creds_path = self._resolve_path(config.GMAIL_CREDENTIALS_PATH)
        token_path = self._resolve_path(config.GMAIL_TOKEN_PATH)

        creds = None
        if token_path.exists():
            try:
                creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
            except ValueError:
                creds = None

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
                self._persist_refreshed_token(creds, token_path)
            else:
                raise GmailNotConfiguredError(
                    "Gmail is not authenticated. Set GMAIL_TOKEN_JSON in .env, or place "
                    "credentials.json and run `python -m scripts.gmail_auth` from the backend "
                    f"directory (credentials: {creds_path}, token: {token_path})."
                )

        return creds

    def run_interactive_oauth(self) -> Credentials:
        """One-time desktop OAuth flow; persists token.json. Dev/bootstrap only."""
        from google_auth_oauthlib.flow import InstalledAppFlow

        client_config = self._load_client_config()
        token_path = self._resolve_path(config.GMAIL_TOKEN_PATH)

        flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
        creds = flow.run_local_server(port=0)
        token_text = creds.to_json()
        self._persist_refreshed_token(creds, token_path)
        if not (env_settings.GMAIL_TOKEN_JSON or "").strip():
            print(
                "Tip: copy the token into .env as GMAIL_TOKEN_JSON "
                "(single-line JSON, wrap in single quotes if needed)."
            )
            print(token_text)
        return creds

    def load_credentials_from_integration(
        self, token_json: str | dict | None
    ) -> Credentials:
        if not token_json:
            return self.load_credentials()

        if isinstance(token_json, str):
            info = json.loads(token_json)
        else:
            info = token_json
        return self._ensure_valid_credentials(
            Credentials.from_authorized_user_info(info, SCOPES)
        )

    def send_mime_message(
        self,
        to_email: str,
        subject: str,
        mime_message: MIMEText,
        *,
        token_json: str | dict | None = None,
    ) -> str:
        mime_message["to"] = to_email
        mime_message["subject"] = subject

        creds = self.load_credentials_from_integration(token_json)
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        raw = base64.urlsafe_b64encode(mime_message.as_bytes()).decode("utf-8")
        result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
        return str(result.get("id", ""))
