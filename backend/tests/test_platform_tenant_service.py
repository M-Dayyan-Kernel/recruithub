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
            settings_repo=MagicMock(),
        )
        # The name emails sign off with, as the settings row the service would update.
        self.email_settings = SimpleNamespace(company_name="Emails Co")
        service._settings.get_or_create = AsyncMock(return_value=self.email_settings)
        service._get_customer_tenant = AsyncMock(return_value=tenant)
        service._session.commit = AsyncMock()
        service._tenants.refresh = AsyncMock()
        service._tenants.name_exists = AsyncMock(return_value=False)
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
        service._tenants.name_exists.assert_awaited_once()

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


class RenameReachesEmailsTests(DeactivationGuardTests):
    """Renaming an organisation changes the name its emails use, from then on."""

    async def test_a_rename_carries_the_new_name_to_the_email_settings(self):
        tenant = _tenant(slug="acme")
        service = self._service(tenant)
        await service.update_tenant(
            tenant.id, TenantUpdateRequest(name="Acme Global"), MagicMock()
        )
        self.assertEqual(tenant.name, "Acme Global")
        self.assertEqual(self.email_settings.company_name, "Acme Global")
        service._settings.get_or_create.assert_awaited_once_with(
            tenant.id, company_name="Acme Global"
        )

    async def test_saving_the_same_name_again_leaves_the_email_name_alone(self):
        # Not a rename: an unrelated edit must not overwrite a deliberately different name,
        # such as the default organisation's, which emails sign off as something else.
        tenant = _tenant(slug="acme")
        service = self._service(tenant)
        await service.update_tenant(tenant.id, TenantUpdateRequest(name="Org"), MagicMock())
        self.assertEqual(self.email_settings.company_name, "Emails Co")
        service._settings.get_or_create.assert_not_awaited()

    async def test_other_edits_do_not_touch_the_email_name(self):
        tenant = _tenant(slug="acme")
        service = self._service(tenant)
        await service.update_tenant(
            tenant.id, TenantUpdateRequest(is_active=False), MagicMock()
        )
        self.assertEqual(self.email_settings.company_name, "Emails Co")
        service._settings.get_or_create.assert_not_awaited()

    async def test_changing_only_the_letter_case_counts_as_a_rename(self):
        tenant = _tenant(slug="acme")
        service = self._service(tenant)
        await service.update_tenant(tenant.id, TenantUpdateRequest(name="ORG"), MagicMock())
        self.assertEqual(self.email_settings.company_name, "ORG")

    async def test_the_email_name_changes_in_the_renames_own_transaction(self):
        tenant = _tenant(slug="acme")
        service = self._service(tenant)
        order = []
        service._settings.get_or_create = AsyncMock(
            side_effect=lambda *a, **k: order.append("email name") or self.email_settings
        )
        service._session.commit = AsyncMock(side_effect=lambda: order.append("commit"))
        await service.update_tenant(
            tenant.id, TenantUpdateRequest(name="Acme Global"), MagicMock()
        )
        self.assertEqual(order, ["email name", "commit"])


if __name__ == "__main__":
    unittest.main()
