import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import RequireAdmin
from app.models.models import AuditLog
from app.schemas.schemas import AuditLogListResponse, AuditLogResponse

router = APIRouter()


@router.get("", response_model=AuditLogListResponse)
async def list_audit_logs(
    _admin: RequireAdmin,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    entity_type: Optional[str] = Query(None),
    job_id: Optional[uuid.UUID] = Query(None),
    actor_user_id: Optional[uuid.UUID] = Query(None),
    q: Optional[str] = Query(None, description="Search subject, feature, or actor name"),
    from_ts: Optional[datetime] = Query(None, alias="from"),
    to_ts: Optional[datetime] = Query(None, alias="to"),
):
    filters = [AuditLog.tenant_id == _admin.tenant_id]
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type)
    if job_id:
        filters.append(AuditLog.job_id == job_id)
    if actor_user_id:
        filters.append(AuditLog.actor_user_id == actor_user_id)
    if from_ts:
        filters.append(AuditLog.created_at >= from_ts)
    if to_ts:
        filters.append(AuditLog.created_at <= to_ts)
    if q and q.strip():
        term = f"%{q.strip()}%"
        filters.append(
            or_(
                AuditLog.subject_label.ilike(term),
                AuditLog.feature.ilike(term),
                AuditLog.actor_name.ilike(term),
                AuditLog.action.ilike(term),
            )
        )

    count_q = select(func.count()).select_from(AuditLog)
    list_q = select(AuditLog).order_by(AuditLog.created_at.desc())
    count_q = count_q.where(*filters)
    list_q = list_q.where(*filters)

    total = (await db.execute(count_q)).scalar_one()
    rows = (
        await db.execute(list_q.limit(limit).offset(offset))
    ).scalars().all()

    return AuditLogListResponse(
        items=[AuditLogResponse.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
