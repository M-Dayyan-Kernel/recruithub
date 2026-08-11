"""Per-tenant talentOS outbound connection values.

Stored inside recruithub's existing ``system_settings.integrations`` JSON
column using their own Fernet ``encrypt_value``/``decrypt_value`` helpers, so
secrets are encrypted at rest with the same key and recruithub's settings
merge logic is untouched (recruithub only reads its own SECRET_FIELDS keys).

Resolution order per field: tenant override -> platform .env -> missing.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import settings
from app.repositories.system_settings_repository import SystemSettingsRepository
from app.services.tenant_integrations_service import decrypt_value, encrypt_value

CONNECTION_FIELDS = ("talentos_be_url", "talentos_be_api_key")

PLATFORM_FIELD_ENV = {
    "talentos_be_url": "TALENTOS_BE_URL",
    "talentos_be_api_key": "TALENTOS_BE_API_KEY",
}


async def load_tenant_connection(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Any]:
    """Return ``{values: {...}, sources: {...}}`` for a tenant's talentOS connection."""
    repo = SystemSettingsRepository(db)
    row = await repo.get_by_tenant_id(tenant_id)
    stored = (row.integrations or {}) if row else {}

    values: dict[str, str] = {}
    sources: dict[str, str] = {}
    for key in CONNECTION_FIELDS:
        raw = stored.get(key)
        if raw:
            decrypted = decrypt_value(str(raw))
            if decrypted:
                values[key] = decrypted
                sources[key] = "tenant"
                continue
        env_val = getattr(settings, PLATFORM_FIELD_ENV[key], "") or ""
        if env_val:
            values[key] = env_val
            sources[key] = "platform"
        else:
            values[key] = ""
            sources[key] = "missing"
    return {"values": values, "sources": sources}


async def save_tenant_connection(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    talentos_be_url: Optional[str] = None,
    talentos_be_api_key: Optional[str] = None,
) -> dict[str, Any]:
    """Persist tenant overrides. An empty string clears the override."""
    repo = SystemSettingsRepository(db)
    row = await repo.get_or_create(tenant_id)
    stored = dict(row.integrations or {})

    updates = {"talentos_be_url": talentos_be_url, "talentos_be_api_key": talentos_be_api_key}
    for key, value in updates.items():
        if value is None:
            continue
        if value.strip():
            stored[key] = encrypt_value(value.strip())
        else:
            stored.pop(key, None)

    row.integrations = stored
    await db.commit()
    return await load_tenant_connection(db, tenant_id)
