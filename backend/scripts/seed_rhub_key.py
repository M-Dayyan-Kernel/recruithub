"""Seed or update the `rhub_` API key used by talentOS BE to authenticate against the POC.

Usage:
    python -m scripts.seed_rhub_key              # reads RH_API_KEY from env
    python -m scripts.seed_rhub_key <full_key>   # explicit key

Idempotent: upserts by key_hash. If the key already exists, it stays active and its
name/description are refreshed.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.api_key import ApiKey
from app.modules.api_keys.api_key_service import API_KEY_PREFIX


NAME = "talentOS-BE"
DESCRIPTION = "Service key used by talentOS BE (RH_API_KEY) to call POC /internal endpoints."


async def _upsert(full_key: str) -> None:
    if not full_key.startswith(API_KEY_PREFIX):
        raise SystemExit(f"API key must start with '{API_KEY_PREFIX}' (got prefix {full_key[:8]!r})")

    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    key_prefix = full_key[:8]

    async with AsyncSessionLocal() as session:
        existing = (
            await session.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
        ).scalars().first()

        if existing:
            existing.name = NAME
            existing.description = DESCRIPTION
            existing.is_active = True
            action = "updated"
        else:
            session.add(
                ApiKey(
                    name=NAME,
                    description=DESCRIPTION,
                    key_hash=key_hash,
                    key_prefix=key_prefix,
                    is_active=True,
                )
            )
            action = "created"

        await session.commit()

    print(f"rhub_ API key {action} (prefix={key_prefix}, name={NAME!r}).")


def _resolve_key() -> str:
    if len(sys.argv) >= 2 and sys.argv[1].strip():
        return sys.argv[1].strip()
    from_env = os.environ.get("RH_API_KEY") or os.environ.get("TALENTOS_RH_API_KEY")
    if not from_env:
        raise SystemExit(
            "No key provided. Pass the full rhub_... key as an argument or set RH_API_KEY."
        )
    return from_env.strip()


if __name__ == "__main__":
    asyncio.run(_upsert(_resolve_key()))
