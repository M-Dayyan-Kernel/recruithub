"""Superadmin talentOS connection management across customer organizations."""

from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import PLATFORM_TENANT_SLUG
from app.exceptions import BadRequestError, ConflictError, DomainError, NotFoundError, UpstreamError
from app.models.models import Tenant
from app.modules.talentos_integration.connect_models import (
    PROVIDER_TALENTOS,
    STATE_DISCONNECTED,
    STATE_NONE,
    TRANSIENT_STATES,
    IntegrationLink,
    IntegrationLinkFlow,
    utcnow,
)
from app.modules.talentos_integration.connect_service import MAX_ATTEMPTS, ConnectService
from app.repositories.tenant_repository import TenantRepository
from app.schemas.schemas import PlatformConnectionItem

logger = logging.getLogger(__name__)


class PlatformConnectionsService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        tenant_repo: TenantRepository | None = None,
    ) -> None:
        self._session = session
        self._tenants = tenant_repo or TenantRepository(session)

    async def list_connections(self) -> list[PlatformConnectionItem]:
        await self._advance_pending_outbound_pings()
        result = await self._session.execute(
            select(Tenant, IntegrationLink, IntegrationLinkFlow)
            .outerjoin(
                IntegrationLink,
                and_(
                    IntegrationLink.tenant_id == Tenant.id,
                    IntegrationLink.provider == PROVIDER_TALENTOS,
                ),
            )
            .outerjoin(
                IntegrationLinkFlow,
                IntegrationLinkFlow.flow_id == IntegrationLink.current_flow_id,
            )
            .where(Tenant.slug != PLATFORM_TENANT_SLUG)
            .order_by(Tenant.name.asc())
        )
        items: list[PlatformConnectionItem] = []
        for tenant, link, flow in result.all():
            state = link.state if link else STATE_NONE
            if state == STATE_DISCONNECTED:
                state = STATE_NONE
            items.append(
                PlatformConnectionItem(
                    tenant_id=tenant.id,
                    name=tenant.name,
                    slug=tenant.slug,
                    is_active=tenant.is_active,
                    verification_status=tenant.verification_status,  # type: ignore[arg-type]
                    state=state,
                    flow_id=link.current_flow_id if link else None,
                    ping_a_verified=bool(flow.ping_a_verified) if flow else False,
                    ping_b_verified=bool(flow.ping_b_verified) if flow else False,
                    connected_at=link.connected_at if link else None,
                    last_error=flow.last_error if flow else None,
                )
            )
        return items

    async def connect_tenant(self, tenant_id: uuid.UUID) -> dict:
        tenant = await self._get_customer_tenant(tenant_id)
        if tenant.verification_status != "approved" or not tenant.is_active:
            raise BadRequestError(
                public_message="Approve and activate the organization before connecting talentOS"
            )
        try:
            result = await ConnectService(self._session).start_connect(
                actor_tenant_id=tenant.id,
                tenant_name=tenant.name,
            )
            await self._session.commit()
            return result
        except DomainError:
            await self._session.rollback()
            raise
        except HTTPException as exc:
            await self._session.rollback()
            raise _http_to_domain(exc) from exc
        except Exception:
            await self._session.rollback()
            logger.exception("Platform connect failed | tenant_id=%s", tenant_id)
            raise UpstreamError(public_message="Connect failed") from None

    async def disconnect_tenant(self, tenant_id: uuid.UUID) -> dict:
        tenant = await self._get_customer_tenant(tenant_id)
        try:
            result = await ConnectService(self._session).disconnect(
                actor_tenant_id=tenant.id,
            )
            await self._session.commit()
            return result
        except DomainError:
            await self._session.rollback()
            raise
        except HTTPException as exc:
            await self._session.rollback()
            raise _http_to_domain(exc) from exc
        except Exception:
            await self._session.rollback()
            logger.exception("Platform disconnect failed | tenant_id=%s", tenant_id)
            raise UpstreamError(public_message="Disconnect failed") from None

    async def _advance_pending_outbound_pings(self) -> None:
        """Complete ping_b for due connect flows so the list UI is not Celery-only.

        Only flows that still need the outbound talentOS ping are touched. Flows
        already waiting on ping_a are left alone — full reconcile would burn
        retry budget on every poll.
        """
        result = await self._session.execute(
            select(IntegrationLinkFlow).where(
                IntegrationLinkFlow.state.in_(TRANSIENT_STATES),
                IntegrationLinkFlow.ping_b_verified.is_(False),
                IntegrationLinkFlow.next_retry_at <= utcnow(),
                IntegrationLinkFlow.attempts < MAX_ATTEMPTS,
            ).limit(50)
        )
        flows = list(result.scalars().all())
        if not flows:
            return
        service = ConnectService(self._session)
        for flow in flows:
            try:
                await service.reconcile_flow(flow)
                await self._session.commit()
            except Exception:
                await self._session.rollback()
                logger.exception(
                    "Outbound ping during connections list failed | flow_id=%s",
                    flow.flow_id,
                )

    async def _get_customer_tenant(self, tenant_id: uuid.UUID) -> Tenant:
        tenant = await self._tenants.get_by_id(tenant_id)
        if tenant is None or tenant.slug == PLATFORM_TENANT_SLUG:
            raise NotFoundError(public_message="Organization not found")
        return tenant


def _http_to_domain(exc: HTTPException) -> DomainError:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    if exc.status_code == 409:
        return ConflictError(public_message=detail)
    if exc.status_code == 502:
        return UpstreamError(public_message=detail)
    if exc.status_code == 404:
        return NotFoundError(public_message=detail)
    return BadRequestError(public_message=detail)
