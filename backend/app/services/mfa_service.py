"""TOTP MFA helpers for admin users."""

from __future__ import annotations

import io
import base64

from app.core.config_loader import config


def generate_mfa_secret() -> str:
    import pyotp

    return pyotp.random_base32()


def provisioning_uri(*, secret: str, email: str) -> str:
    import pyotp

    totp = pyotp.TOTP(secret)
    issuer = "AI Recruitment"
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def verify_mfa_code(*, secret: str, code: str) -> bool:
    import pyotp

    totp = pyotp.TOTP(secret)
    return totp.verify((code or "").strip(), valid_window=1)
