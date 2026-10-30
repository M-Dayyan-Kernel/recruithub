"""An organization's AI-extension check: its blocklist, defaults and seen extensions.

Admins edit; HR can read everything here (they need to see what is being checked and why a
candidate was stopped). The per-job switch is not here: it is a field on the job, edited with it.
Tenancy is enforced in the repository queries, so an id from another organization is a 404.
"""

from __future__ import annotations

import uuid
from typing import List, Literal

from fastapi import APIRouter, Depends, Query, status

from app.dependencies import (
    RequireAdmin,
    RequireAdminOrHr,
    get_integrity_service,
    get_observed_extension_service,
)
from app.schemas.integrity import (
    AddObservedToBlocklist,
    BlocklistEntryCreate,
    BlocklistEntryResponse,
    BlocklistEntryUpdate,
    ObservedExtensionPage,
    ObservedExtensionResponse,
    OrgPolicyResponse,
    OrgPolicyUpdate,
    RestoreDefaultsResult,
)
from app.services.integrity_service import IntegrityService
from app.services.observed_extension_service import ObservedExtensionService

router = APIRouter()


def _can_edit(user) -> bool:
    return user.role in ("admin", "superadmin")


@router.get("", response_model=OrgPolicyResponse)
async def get_extension_policy(
    actor: RequireAdminOrHr,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.get_org_policy(actor, can_edit=_can_edit(actor))


@router.put("", response_model=OrgPolicyResponse)
async def update_extension_policy(
    body: OrgPolicyUpdate,
    admin: RequireAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.update_org_policy(body, admin)


@router.get("/blocklist", response_model=List[BlocklistEntryResponse])
async def list_blocklist(
    actor: RequireAdminOrHr,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.list_blocklist(actor.tenant_id)


@router.post("/blocklist", response_model=BlocklistEntryResponse, status_code=status.HTTP_201_CREATED)
async def add_blocklist_entry(
    body: BlocklistEntryCreate,
    admin: RequireAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.add_entry(body, admin)


@router.patch("/blocklist/{entry_id}", response_model=BlocklistEntryResponse)
async def update_blocklist_entry(
    entry_id: uuid.UUID,
    body: BlocklistEntryUpdate,
    admin: RequireAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.update_entry(entry_id, body, admin)


@router.delete("/blocklist/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_blocklist_entry(
    entry_id: uuid.UUID,
    admin: RequireAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    await service.delete_entry(entry_id, admin)


@router.post("/restore-defaults", response_model=RestoreDefaultsResult)
async def restore_default_entries(
    admin: RequireAdmin,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.restore_defaults(admin)


# ── Seen extensions: flagged on this organization's candidates, awaiting a decision ────────


@router.get("/observed", response_model=ObservedExtensionPage)
async def list_observed_extensions(
    actor: RequireAdminOrHr,
    status_filter: Literal["new", "dismissed"] = Query("new", alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    service: ObservedExtensionService = Depends(get_observed_extension_service),
):
    return await service.list_page(actor.tenant_id, status=status_filter, limit=limit, offset=offset)


@router.post(
    "/observed/{extension_row_id}/add-to-blocklist",
    response_model=BlocklistEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_observed_to_blocklist(
    extension_row_id: uuid.UUID,
    admin: RequireAdmin,
    body: AddObservedToBlocklist | None = None,
    service: IntegrityService = Depends(get_integrity_service),
):
    return await service.add_observed_to_blocklist(extension_row_id, body or AddObservedToBlocklist(), admin)


@router.post("/observed/{extension_row_id}/dismiss", response_model=ObservedExtensionResponse)
async def dismiss_observed_extension(
    extension_row_id: uuid.UUID,
    admin: RequireAdmin,
    service: ObservedExtensionService = Depends(get_observed_extension_service),
):
    return await service.dismiss(extension_row_id, admin)


@router.post("/observed/{extension_row_id}/restore", response_model=ObservedExtensionResponse)
async def restore_observed_extension(
    extension_row_id: uuid.UUID,
    admin: RequireAdmin,
    service: ObservedExtensionService = Depends(get_observed_extension_service),
):
    return await service.restore(extension_row_id, admin)
