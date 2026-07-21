"""Nightly data retention across tenants."""

import asyncio
import logging

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.database import get_celery_db
from app.models.models import Tenant
from app.services.retention_service import apply_retention_for_tenant

logger = logging.getLogger(__name__)


@celery_app.task(name="tasks.apply_data_retention")
def apply_data_retention():
    try:
        asyncio.run(_async_apply())
    except Exception as exc:
        logger.error("apply_data_retention failed: %s", exc)


async def _async_apply() -> None:
    async with get_celery_db() as session:
        result = await session.execute(select(Tenant.id))
        tenant_ids = [row[0] for row in result.all()]
        total = 0
        for tenant_id in tenant_ids:
            total += await apply_retention_for_tenant(session, tenant_id)
        if total:
            logger.info("Retention erased PII for %d candidates", total)
