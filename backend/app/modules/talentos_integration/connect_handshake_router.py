"""One-click connect handshake routes — POC side.

This router is the ``ping_a`` target: talentOS calls ``GET
/internal/talentos/connections/ping`` with a per-tenant ``rhub_`` key (Bearer) and
``X-Flow-Id``. Unlike the rest of ``/internal/talentos/*`` (which use shared-role
dependencies), the ``rhub_`` key IS the credential — it is read from the
Authorization header directly and validated on the spot. No shared secret.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.modules.talentos_integration.connect_service import ConnectService

router = APIRouter(
    prefix="/internal/talentos/connections",
    tags=["talentos-connect"],
)


@router.get("/ping", status_code=200)
async def ping(
    flow_id: UUID = Header(alias="X-Flow-Id"),
    authorization: str | None = Header(
        default=None, alias="Authorization", include_in_schema=False
    ),
    db: AsyncSession = Depends(get_db),
):
    """Mutual ping (ping_a): talentOS -> POC with Bearer rhub_ + X-Flow-Id.

    Derives the tenant from the presented key and returns OUR link binding
    proof — never trusts a caller-supplied tenant id.
    """
    raw_key = None
    if authorization and authorization.startswith("Bearer "):
        raw_key = authorization.split(" ", 1)[1].strip()
    try:
        result = await ConnectService(db).handle_ping(flow_id=flow_id, raw_key=raw_key)
        await db.commit()
        return result
    except HTTPException:
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Ping failed")
