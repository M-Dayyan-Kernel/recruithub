"""
One-time Gmail OAuth bootstrap for local development.

Usage (from backend/):
    python -m scripts.gmail_auth
"""

from app.services.gmail_service import run_interactive_oauth


def main() -> None:
    creds = run_interactive_oauth()
    print("Gmail authentication successful.")
    print(f"Token saved. Scopes: {', '.join(creds.scopes or [])}")


if __name__ == "__main__":
    main()
