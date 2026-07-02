"""
System settings API — geography and outbound call restrictions.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import SystemSettings
from app.schemas.schemas import SystemSettingsResponse, SystemSettingsUpdate
from app.services.settings_service import invalidate_settings_cache

router = APIRouter()


async def _get_or_create_settings(db: AsyncSession) -> SystemSettings:
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    row = result.scalar_one_or_none()
    if row:
        return row

    row = SystemSettings(
        id=1,
        allowed_phone_regions=["IN"],
        enforce_phone_geography=True,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/settings", response_model=SystemSettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """Return system-wide settings (geography, etc.)."""
    return await _get_or_create_settings(db)


@router.patch("/settings", response_model=SystemSettingsResponse)
async def update_settings(
    payload: SystemSettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update system-wide settings."""
    row = await _get_or_create_settings(db)
    data = payload.model_dump(exclude_unset=True)

    if "allowed_phone_regions" in data and data["allowed_phone_regions"] is not None:
        if not data["allowed_phone_regions"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="allowed_phone_regions must contain at least one region",
            )
        row.allowed_phone_regions = data["allowed_phone_regions"]

    if "enforce_phone_geography" in data and data["enforce_phone_geography"] is not None:
        row.enforce_phone_geography = data["enforce_phone_geography"]

    await db.commit()
    await db.refresh(row)
    invalidate_settings_cache()
    return row
