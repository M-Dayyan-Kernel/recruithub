"""Per-tenant talentOS outbound connection settings.

Reads/writes the talentOS BE URL + API key that this tenant's POC uses to push
screening/interview results back to talentOS. Values live encrypted in
``system_settings.integrations`` (see tenant_connection). Platform defaults
come from the server .env and are read-only here.

Lives under ``/api/integrations`` — disjoint from recruithub's namespaces.

Also hosts the one-click connect lifecycle (``/api/integrations/talentos/connect``
and ``/api/integrations/talentos/disconnect``).
"""

from __future__ import annotations

import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies import RequireAdmin
from app.modules.talentos_integration.tenant_connection import (
    load_tenant_connection,
    save_tenant_connection,
)
from app.modules.talentos_integration.connect_service import ConnectService
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


class TalentosConnectRequest(BaseModel):
    flow_id: Optional[uuid.UUID] = Field(
        None, description="Idempotency key. Omit to let the server generate one."
    )
    tenant_name: str | None = Field(
        None, description="Name for the provisioned talentOS tenant (talentOS-side)."
    )


class TalentosDisconnectRequest(BaseModel):
    flow_id: Optional[uuid.UUID] = Field(None, description="Idempotency key for disconnect.")


@router.post("/integrations/talentos/connect", status_code=200)
async def connect_talentos(
    payload: TalentosConnectRequest,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    """One-click connect: mint rhub_, provision talentOS, return tal_ once."""
    try:
        result = await ConnectService(db).start_connect(
            actor_tenant_id=admin.tenant_id,
            flow_id=payload.flow_id,
            tenant_name=payload.tenant_name,
        )
        await db.commit()
        return result
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Connect failed")


@router.get("/integrations/talentos/connect", status_code=200)
async def connect_talentos_status(
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Return the tenant's most recent connect flow status (never credentials)."""
    link = await ConnectService(db)._get_existing_link(admin.tenant_id)
    if link is None or link.current_flow_id is None:
        return {"state": "none", "flow_id": None}
    status = await ConnectService(db).get_status(link.current_flow_id)
    return status


@router.post("/integrations/talentos/disconnect", status_code=200)
async def disconnect_talentos(
    payload: TalentosDisconnectRequest,
    admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
):
    """One-click disconnect: revoke tal_ remotely + rhub_ locally, reset link."""
    try:
        result = await ConnectService(db).disconnect(
            actor_tenant_id=admin.tenant_id,
            flow_id=payload.flow_id,
        )
        await db.commit()
        return result
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Disconnect failed")
