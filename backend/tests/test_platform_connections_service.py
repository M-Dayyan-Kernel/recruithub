"""Backend checks for platform-level talentOS connect/disconnect."""

import uuid
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.exceptions import BadRequestError, ConflictError, NotFoundError, UpstreamError
from app.services.platform_connections_service import (
    PlatformConnectionsService,
    _http_to_domain,
)

TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


def _tenant(*, status: str = "approved", is_active: bool = True, slug: str = "acme"):
    return SimpleNamespace(
        id=TENANT_ID,
        name="Acme",
        slug=slug,
        is_active=is_active,
        verification_status=status,
    )


class ConnectGuardTests(unittest.IsolatedAsyncioTestCase):
    def _service(self, tenant):
        service = PlatformConnectionsService(MagicMock(), tenant_repo=MagicMock())
        service._get_customer_tenant = AsyncMock(return_value=tenant)
        service._session.commit = AsyncMock()
        service._session.rollback = AsyncMock()
        return service

    async def test_pending_org_cannot_connect(self):
        service = self._service(_tenant(status="pending", is_active=False))
        with self.assertRaises(BadRequestError) as ctx:
            await service.connect_tenant(TENANT_ID)
        self.assertIn("Approve and activate", ctx.exception.public_message)

    async def test_inactive_org_cannot_connect(self):
        service = self._service(_tenant(is_active=False))
        with self.assertRaises(BadRequestError):
            await service.connect_tenant(TENANT_ID)

    async def test_rejected_org_cannot_connect(self):
        service = self._service(_tenant(status="rejected", is_active=False))
        with self.assertRaises(BadRequestError):
            await service.connect_tenant(TENANT_ID)

    async def test_missing_org_is_not_found(self):
        repo = MagicMock()
        repo.get_by_id = AsyncMock(return_value=None)
        service = PlatformConnectionsService(MagicMock(), tenant_repo=repo)
        with self.assertRaises(NotFoundError):
            await service.connect_tenant(TENANT_ID)

    async def test_platform_tenant_is_hidden(self):
        repo = MagicMock()
        repo.get_by_id = AsyncMock(return_value=_tenant(slug="platform"))
        service = PlatformConnectionsService(MagicMock(), tenant_repo=repo)
        with self.assertRaises(NotFoundError):
            await service.connect_tenant(TENANT_ID)

    async def test_approved_org_connect_calls_connect_service(self):
        tenant = _tenant()
        service = self._service(tenant)
        fake = MagicMock()
        fake.start_connect = AsyncMock(
            return_value={"state": "keys_exchanged", "flow_id": str(uuid.uuid4())}
        )
        with patch(
            "app.services.platform_connections_service.ConnectService",
            return_value=fake,
        ):
            result = await service.connect_tenant(TENANT_ID)
        fake.start_connect.assert_awaited_once_with(
            actor_tenant_id=tenant.id,
            tenant_name=tenant.name,
        )
        service._session.commit.assert_awaited_once()
        self.assertEqual(result["state"], "keys_exchanged")

    async def test_already_connected_maps_to_conflict(self):
        service = self._service(_tenant())
        fake = MagicMock()
        fake.start_connect = AsyncMock(
            side_effect=HTTPException(status_code=409, detail="Already connected")
        )
        with patch(
            "app.services.platform_connections_service.ConnectService",
            return_value=fake,
        ):
            with self.assertRaises(ConflictError) as ctx:
                await service.connect_tenant(TENANT_ID)
        self.assertEqual(ctx.exception.public_message, "Already connected")
        service._session.rollback.assert_awaited()

    async def test_disconnect_calls_connect_service(self):
        tenant = _tenant()
        service = self._service(tenant)
        fake = MagicMock()
        fake.disconnect = AsyncMock(return_value={"state": "none", "result": "ok"})
        with patch(
            "app.services.platform_connections_service.ConnectService",
            return_value=fake,
        ):
            result = await service.disconnect_tenant(TENANT_ID)
        fake.disconnect.assert_awaited_once_with(actor_tenant_id=tenant.id)
        service._session.commit.assert_awaited_once()
        self.assertEqual(result["state"], "none")


class ListMappingTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_maps_missing_disconnected_and_linked_rows(self):
        none_tenant = SimpleNamespace(
            id=uuid.UUID("00000000-0000-0000-0000-000000000011"),
            name="Bare Org",
            slug="bare-org",
            is_active=True,
            verification_status="approved",
        )
        linked_tenant = SimpleNamespace(
            id=uuid.UUID("00000000-0000-0000-0000-000000000012"),
            name="Linked Org",
            slug="linked-org",
            is_active=True,
            verification_status="approved",
        )
        disconnected_tenant = SimpleNamespace(
            id=uuid.UUID("00000000-0000-0000-0000-000000000013"),
            name="Was Linked",
            slug="was-linked",
            is_active=True,
            verification_status="approved",
        )
        flow_id = uuid.UUID("ffffffff-0000-0000-0000-000000000001")
        connected_at = datetime(2026, 8, 23, tzinfo=timezone.utc)
        linked_link = SimpleNamespace(
            state="linked",
            current_flow_id=flow_id,
            connected_at=connected_at,
        )
        linked_flow = SimpleNamespace(
            ping_a_verified=True,
            ping_b_verified=True,
            last_error=None,
        )
        disconnected_link = SimpleNamespace(
            state="disconnected",
            current_flow_id=None,
            connected_at=None,
        )

        session = MagicMock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()
        pending = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))
        listing = SimpleNamespace(
            all=lambda: [
                (none_tenant, None, None),
                (linked_tenant, linked_link, linked_flow),
                (disconnected_tenant, disconnected_link, None),
            ]
        )
        session.execute = AsyncMock(side_effect=[pending, listing])
        service = PlatformConnectionsService(session, tenant_repo=MagicMock())
        items = await service.list_connections()

        self.assertEqual(len(items), 3)
        by_slug = {item.slug: item for item in items}
        self.assertEqual(by_slug["bare-org"].state, "none")
        self.assertFalse(by_slug["bare-org"].ping_a_verified)
        self.assertEqual(by_slug["linked-org"].state, "linked")
        self.assertTrue(by_slug["linked-org"].ping_a_verified)
        self.assertEqual(by_slug["linked-org"].flow_id, flow_id)
        self.assertEqual(by_slug["was-linked"].state, "none")

    async def test_list_advances_due_outbound_pings(self):
        flow = SimpleNamespace(flow_id=uuid.uuid4())
        pending = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [flow]))
        listing = SimpleNamespace(all=lambda: [])
        session = MagicMock()
        session.commit = AsyncMock()
        session.rollback = AsyncMock()
        session.execute = AsyncMock(side_effect=[pending, listing])
        service = PlatformConnectionsService(session, tenant_repo=MagicMock())
        fake = MagicMock()
        fake.reconcile_flow = AsyncMock(return_value="await_inbound_ping")
        with patch(
            "app.services.platform_connections_service.ConnectService",
            return_value=fake,
        ):
            items = await service.list_connections()
        fake.reconcile_flow.assert_awaited_once_with(flow)
        session.commit.assert_awaited()
        self.assertEqual(items, [])


class HttpMappingTests(unittest.TestCase):
    def test_conflict(self):
        err = _http_to_domain(HTTPException(status_code=409, detail="Already connected"))
        self.assertIsInstance(err, ConflictError)
        self.assertEqual(err.public_message, "Already connected")

    def test_upstream(self):
        err = _http_to_domain(HTTPException(status_code=502, detail="talentOS provisioning failed"))
        self.assertIsInstance(err, UpstreamError)

    def test_not_found(self):
        err = _http_to_domain(HTTPException(status_code=404, detail="Flow not found"))
        self.assertIsInstance(err, NotFoundError)
