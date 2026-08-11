"""Per-tenant talentOS outbound connection settings.

Reads/writes the talentOS BE URL + API key that this tenant's POC uses to push
screening/interview results back to talentOS. Values live encrypted in
``system_settings.integrations`` (see tenant_connection). Platform defaults
come from the server .env and are read-only here.

Lives under ``/api/integrations`` — disjoint from recruithub's namespaces.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.dependencies import RequireAdmin
from app.modules.talentos_integration.tenant_connection import (
    load_tenant_connection,
    save_tenant_connection,
)
from app.services.tenant_integrations_service import mask_secret
from app.core.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


class ConnectionFieldResponse(BaseModel):
    configured: bool
    source: str
    hint: Optional[str] = None


class TalentosConnectionResponse(BaseModel):
    fields: dict[str, ConnectionFieldResponse]


class TalentosConnectionUpdate(BaseModel):
    talentos_be_url: Optional[str] = Field(
        None, description="talentOS BE base URL. Empty string clears the tenant override."
    )
    talentos_be_api_key: Optional[str] = Field(
        None, description="talentOS BE API key (Bearer). Empty string clears the tenant override."
    )


SECRET_FIELD = "talentos_be_api_key"
URL_FIELD = "talentos_be_url"


def _field_response(key: str, value: str, source: str) -> ConnectionFieldResponse:
    configured = bool(value.strip())
    if not configured:
        return ConnectionFieldResponse(configured=False, source="missing")
    if key == SECRET_FIELD:
        return ConnectionFieldResponse(configured=True, source=source, hint=mask_secret(value))
    return ConnectionFieldResponse(configured=True, source=source, hint=value)


async def _response(tenant_id: uuid.UUID, db: AsyncSession) -> TalentosConnectionResponse:
    data = await load_tenant_connection(db, tenant_id)
    values = data["values"]
    sources = data["sources"]
    return TalentosConnectionResponse(
        fields={
            key: _field_response(key, values.get(key, ""), sources.get(key, "missing"))
            for key in (URL_FIELD, SECRET_FIELD)
        }
    )


@router.get("/integrations/talentos", response_model=TalentosConnectionResponse)
async def get_talentos_connection(
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    return await _response(admin.tenant_id, db)


@router.patch("/integrations/talentos", response_model=TalentosConnectionResponse)
async def update_talentos_connection(
    payload: TalentosConnectionUpdate,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    await save_tenant_connection(
        db,
        admin.tenant_id,
        talentos_be_url=payload.talentos_be_url,
        talentos_be_api_key=payload.talentos_be_api_key,
    )
    return await _response(admin.tenant_id, db)
