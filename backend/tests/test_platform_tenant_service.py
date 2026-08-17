"""Guards around activating/deactivating organizations."""

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.core.constants import DEFAULT_TENANT_SLUG
from app.exceptions import BadRequestError
from app.schemas.schemas import TenantUpdateRequest
from app.services.platform_tenant_service import PlatformTenantService


def _tenant(*, slug: str, is_active: bool = True, status: str = "approved"):
    return SimpleNamespace(
        id="00000000-0000-0000-0000-000000000001",
        name="Org",
        slug=slug,
        is_active=is_active,
        verification_status=status,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


class DeactivationGuardTests(unittest.IsolatedAsyncioTestCase):
    def _service(self, tenant):
        service = PlatformTenantService(
            MagicMock(),
            tenant_repo=MagicMock(),
            user_repo=MagicMock(),
            tenant_service=MagicMock(),
            audit_service=MagicMock(),
            refresh_token_repo=MagicMock(),
        )
        service._get_customer_tenant = AsyncMock(return_value=tenant)
        service._session.commit = AsyncMock()
        service._tenants.refresh = AsyncMock()
        service._audit.log_change = AsyncMock()
        service._refresh_tokens.revoke_all_for_tenant = AsyncMock(return_value=2)
        return service

    async def test_default_organization_cannot_be_deactivated(self):
        tenant = _tenant(slug=DEFAULT_TENANT_SLUG)
        service = self._service(tenant)
        with self.assertRaises(BadRequestError) as ctx:
            await service.update_tenant(
                tenant.id, TenantUpdateRequest(is_active=False), MagicMock()
            )
        self.assertIn("default organization", ctx.exception.public_message)
        self.assertTrue(tenant.is_active)

    async def test_default_organization_can_still_be_renamed(self):
        tenant = _tenant(slug=DEFAULT_TENANT_SLUG)
        service = self._service(tenant)
        await service.update_tenant(
            tenant.id, TenantUpdateRequest(name="Renamed"), MagicMock()
        )
        self.assertEqual(tenant.name, "Renamed")
        self.assertTrue(tenant.is_active)

    async def test_unapproved_organization_cannot_be_activated(self):
        tenant = _tenant(slug="acme", is_active=False, status="pending")
        service = self._service(tenant)
        with self.assertRaises(BadRequestError):
            await service.update_tenant(
                tenant.id, TenantUpdateRequest(is_active=True), MagicMock()
            )

    async def test_deactivating_a_customer_org_revokes_its_sessions(self):
        tenant = _tenant(slug="acme")
        service = self._service(tenant)
        await service.update_tenant(
            tenant.id, TenantUpdateRequest(is_active=False), MagicMock()
        )
        self.assertFalse(tenant.is_active)
        service._refresh_tokens.revoke_all_for_tenant.assert_awaited_once_with(tenant.id)

    async def test_reactivating_does_not_revoke_sessions(self):
        tenant = _tenant(slug="acme", is_active=False)
        service = self._service(tenant)
        await service.update_tenant(
            tenant.id, TenantUpdateRequest(is_active=True), MagicMock()
        )
        self.assertTrue(tenant.is_active)
        service._refresh_tokens.revoke_all_for_tenant.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
