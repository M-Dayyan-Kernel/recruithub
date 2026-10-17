"""Absolute links into the HR web app, built from ``HR_APP_URL``.

Kept in one place so every emailed link agrees on the base URL and encodes its
query string the same way.
"""

from __future__ import annotations

from urllib.parse import urlencode

from app.core.config_loader import config


def hr_app_url(path: str, **query: str) -> str:
    base = (config.HR_APP_URL or "").rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{urlencode(query)}"
    return url


def set_password_url(token: str) -> str:
    """The page that redeems an onboarding or reset token."""
    return hr_app_url("reset-password", token=token)


def login_url() -> str:
    return hr_app_url("login")
