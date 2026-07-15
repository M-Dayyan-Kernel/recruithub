"""Per-tenant external integration credentials (OpenAI, VAPI, LiveKit, Gmail)."""

from __future__ import annotations

import base64
import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import SystemSettings

logger = logging.getLogger(__name__)

SECRET_FIELDS = (
    "openai_api_key",
    "vapi_api_key",
    "vapi_phone_number_id",
    "livekit_url",
    "livekit_api_key",
    "livekit_api_secret",
    "gmail_credentials_json",
    "gmail_token_json",
)

MASK_AS_SECRET = frozenset(
    {
        "openai_api_key",
        "vapi_api_key",
        "livekit_api_key",
        "livekit_api_secret",
        "gmail_credentials_json",
        "gmail_token_json",
    }
)


def _looks_encrypted(value: str) -> bool:
    """Fernet tokens are urlsafe-base64 and typically start with gAAAAA."""
    return bool(value) and value.startswith("gAAAAA")


def _fernet() -> Fernet:
    raw = (settings.INTEGRATIONS_ENCRYPTION_KEY or settings.JWT_SECRET_KEY or "dev").encode(
        "utf-8"
    )
    digest = hashlib.sha256(raw).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_value(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_value(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        if _looks_encrypted(token):
            logger.error(
                "Failed to decrypt integration secret (wrong INTEGRATIONS_ENCRYPTION_KEY "
                "/ JWT_SECRET_KEY?). Not using ciphertext as an API key."
            )
            return ""
        # Plain-text bootstrap values
        return token


@dataclass
class TenantIntegrations:
    tenant_id: uuid.UUID | None
    openai_api_key: str = ""
    vapi_api_key: str = ""
    vapi_phone_number_id: str = ""
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    gmail_credentials_json: str = ""
    gmail_token_json: str = ""
    sources: dict[str, str] = field(default_factory=dict)

    def require(self, *fields: str) -> None:
        missing = [f for f in fields if not (getattr(self, f, "") or "").strip()]
        if missing:
            raise ValueError(
                "Tenant integrations incomplete: missing "
                + ", ".join(missing)
                + ". Configure them under Settings or set platform .env keys."
            )


def _platform_defaults() -> dict[str, str]:
    return {
        "openai_api_key": settings.OPENAI_API_KEY or "",
        "vapi_api_key": settings.VAPI_API_KEY or "",
        "vapi_phone_number_id": settings.VAPI_PHONE_NUMBER_ID or "",
        "livekit_url": settings.LIVEKIT_URL or "",
        "livekit_api_key": settings.LIVEKIT_API_KEY or "",
        "livekit_api_secret": settings.LIVEKIT_API_SECRET or "",
        "gmail_credentials_json": "",
        "gmail_token_json": "",
    }


def _decrypt_stored(stored: dict[str, Any] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    if not stored:
        return out
    for key in SECRET_FIELDS:
        raw = stored.get(key)
        if raw is None or raw == "":
            continue
        decrypted = decrypt_value(str(raw))
        if decrypted:
            out[key] = decrypted
    return out


def merge_integrations(
    tenant_id: uuid.UUID | None,
    stored: dict[str, Any] | None,
    *,
    allow_platform_fallback: bool = True,
) -> TenantIntegrations:
    decrypted = _decrypt_stored(stored)
    platform = _platform_defaults()
    values: dict[str, str] = {}
    sources: dict[str, str] = {}
    for key in SECRET_FIELDS:
        if decrypted.get(key):
            values[key] = decrypted[key]
            sources[key] = "tenant"
        elif allow_platform_fallback and platform.get(key):
            values[key] = platform[key]
            sources[key] = "platform"
        else:
            values[key] = ""
            sources[key] = "missing"
    return TenantIntegrations(tenant_id=tenant_id, sources=sources, **values)


def mask_secret(value: str) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return "••••"
    return f"••••{value[-4:]}"


def public_status(integrations: TenantIntegrations) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for key in SECRET_FIELDS:
        value = getattr(integrations, key, "") or ""
        source = integrations.sources.get(key, "missing")
        configured = bool(value.strip())
        entry: dict[str, Any] = {
            "configured": configured,
            "source": source if configured else "missing",
        }
        if configured and key in MASK_AS_SECRET and key not in (
            "gmail_credentials_json",
            "gmail_token_json",
        ):
            entry["hint"] = mask_secret(value)
        elif configured and key in ("vapi_phone_number_id", "livekit_url"):
            entry["hint"] = value if key == "livekit_url" else mask_secret(value)
        fields[key] = entry
    return {"fields": fields}


def encode_for_storage(
    updates: dict[str, Optional[str]], existing: dict[str, Any] | None
) -> dict[str, Any]:
    stored = dict(existing or {})
    for key, value in updates.items():
        if key not in SECRET_FIELDS:
            continue
        if value is None or value == "":
            stored.pop(key, None)
        else:
            stored[key] = encrypt_value(value.strip())
    return stored


async def load_tenant_integrations(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    allow_platform_fallback: bool = True,
) -> TenantIntegrations:
    result = await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    stored = row.integrations if row else None
    return merge_integrations(
        tenant_id, stored, allow_platform_fallback=allow_platform_fallback
    )


async def get_or_create_settings_row(db: AsyncSession, tenant_id: uuid.UUID) -> SystemSettings:
    result = await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if row:
        return row
    row = SystemSettings(
        tenant_id=tenant_id,
        allowed_phone_regions=["IN"],
        enforce_phone_geography=True,
        screening_enabled=True,
        screening_max_retries=3,
        screening_retry_delay_seconds=1800,
        company_name="Webknot Technologies",
        integrations={},
    )
    db.add(row)
    await db.flush()
    return row
