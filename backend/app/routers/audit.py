import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.dependencies import RequireAdmin, get_audit_service
from app.exceptions import DomainError
from app.schemas.schemas import AuditLogListResponse
from app.services.audit_service import AuditService

router = APIRouter()


def _raise_domain(exc: DomainError):
    from fastapi import HTTPException

    raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from exc


@router.get("", response_model=AuditLogListResponse)
async def list_audit_logs(
    admin: RequireAdmin,
    service: AuditService = Depends(get_audit_service),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    entity_type: Optional[str] = Query(None),
    job_id: Optional[uuid.UUID] = Query(None),
    candidate_id: Optional[uuid.UUID] = Query(None),
    actor_user_id: Optional[uuid.UUID] = Query(None),
    q: Optional[str] = Query(None, description="Search subject, feature, or actor name"),
    from_ts: Optional[datetime] = Query(None, alias="from"),
    to_ts: Optional[datetime] = Query(None, alias="to"),
):
    try:
        return await service.list_logs(
            tenant_id=admin.tenant_id,
            limit=limit,
            offset=offset,
            entity_type=entity_type,
            job_id=job_id,
            candidate_id=candidate_id,
            actor_user_id=actor_user_id,
            from_ts=from_ts,
            to_ts=to_ts,
            search=q,
        )
    except DomainError as exc:
        _raise_domain(exc)
