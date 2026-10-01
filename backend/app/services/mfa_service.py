"""TOTP MFA helpers for admin users."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AuthenticationError, AuthorizationError, BadRequestError
from app.models.models import User
from app.schemas.schemas import MfaSetupResponse


def generate_mfa_secret() -> str:
    import pyotp

    return pyotp.random_base32()


def provisioning_uri(*, secret: str, email: str) -> str:
    import pyotp

    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name="AI Recruitment")


def verify_mfa_code(*, secret: str, code: str) -> bool:
    import pyotp

    totp = pyotp.TOTP(secret)
    return totp.verify((code or "").strip(), valid_window=1)


class MfaService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def setup(self, user: User) -> MfaSetupResponse:
        if user.role not in ("admin", "superadmin"):
            raise AuthorizationError(public_message="MFA setup is limited to admin users")
        secret = generate_mfa_secret()
        user.mfa_secret = secret
        user.mfa_enabled = False
        await self._session.commit()
        return MfaSetupResponse(
            secret=secret,
            provisioning_uri=provisioning_uri(secret=secret, email=user.email),
        )

    async def verify_and_enable(self, user: User, code: str) -> None:
        if not user.mfa_secret:
            raise BadRequestError(public_message="MFA is not configured for this user")
        if not verify_mfa_code(secret=user.mfa_secret, code=code):
            raise AuthenticationError(public_message="Invalid MFA code")
        user.mfa_enabled = True
