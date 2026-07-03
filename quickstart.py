import base64
from email.mime.text import MIMEText
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# If you change SCOPES, delete token.json and re-run to re-authenticate.
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

SCRIPT_DIR = Path(__file__).resolve().parent
CREDENTIALS_PATH = SCRIPT_DIR / "credentials.json"
TOKEN_PATH = SCRIPT_DIR / "token.json"


def load_credentials() -> Credentials:
    creds = None

    if TOKEN_PATH.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
        except ValueError:
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), SCOPES)
            creds = flow.run_local_server(port=0)

        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")

    return creds


def send_test_email(to_email: str) -> None:
    """Send a simple test email to the given address."""
    creds = load_credentials()
    service = build("gmail", "v1", credentials=creds)

    message = MIMEText("Hello! This is a test email from quickstart.py.", "plain", "utf-8")
    message["to"] = to_email
    message["subject"] = "Test email"

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    result = service.users().messages().send(userId="me", body={"raw": raw}).execute()

    print(f"Email sent to {to_email}")
    print(f"Message ID: {result.get('id')}")


if __name__ == "__main__":
    # Change this to your test recipient
    send_test_email("shruthi.sp@webknot.in")
