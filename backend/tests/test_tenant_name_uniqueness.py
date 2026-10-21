"""Organization names are unique, however they are cased or spaced."""

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy.exc import IntegrityError

from app.core.constants import ORG_NAME_TAKEN_MESSAGE, ORG_NAME_UNIQUE_INDEX
from app.core.tenancy import normalize_org_name, org_name_key
from app.exceptions import ConflictError
from app.models.models import Tenant, User
from app.schemas.schemas import TenantUpdateRequest
from app.services.platform_tenant_service import PlatformTenantService
from app.services.tenant_service import TenantService


class NormalizationTests(unittest.TestCase):
    def test_whitespace_is_collapsed_and_trimmed(self):
        self.assertEqual(normalize_org_name("  Acme \t  Corp \n"), "Acme Corp")

    def test_key_ignores_case_and_spacing(self):
        variants = ["Acme Corp", "acme corp", "ACME   CORP", "  Acme Corp  "]
        self.assertEqual({org_name_key(v) for v in variants}, {"acme corp"})

    def test_different_names_have_different_keys(self):
        self.assertNotEqual(org_name_key("Acme Corp"), org_name_key("Acme Corporation"))


def _integrity_error(constraint: str = ORG_NAME_UNIQUE_INDEX) -> IntegrityError:
    return IntegrityError(
        "INSERT INTO tenants ...",
        {},
        Exception(f'duplicate key value violates unique constraint "{constraint}"'),
    )


def _tenant_service(*, exists: bool):
    session = AsyncMock()
    tenants = MagicMock()
    tenants.name_exists = AsyncMock(return_value=exists)
    tenants.ensure_unique_slug = AsyncMock(return_value="acme-corp")
    tenants.add = MagicMock()
    tenants.flush = AsyncMock()
    users = MagicMock()
    users.add = MagicMock()
    users.flush = AsyncMock()
    settings = MagicMock()
    settings.get_or_create = AsyncMock()
    service = TenantService(
        session, tenant_repo=tenants, user_repo=users, settings_repo=settings,
        invite_repo=MagicMock(),
    )
    return service, session, tenants, users


async def _create(service, name="Acme Corp"):
    return await service.create_tenant_with_admin(
        organization_name=name, email="ada@acme-corp.com", password="Sup3r-Secret-Passw0rd!",
        full_name="Ada",
    )


class CreateTenantTests(unittest.IsolatedAsyncioTestCase):
    async def test_duplicate_name_is_rejected_before_anything_is_written(self):
        service, session, tenants, users = _tenant_service(exists=True)
        with self.assertRaises(ConflictError) as ctx:
            await _create(service)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.public_message, ORG_NAME_TAKEN_MESSAGE)
        tenants.add.assert_not_called()
        users.add.assert_not_called()

    async def test_the_check_uses_the_normalized_name(self):
        service, _, tenants, _ = _tenant_service(exists=False)
        await _create(service, name="  Acme    Corp ")
        tenants.name_exists.assert_awaited_once_with("Acme Corp")
        stored = tenants.add.call_args.args[0]
        self.assertEqual(stored.name, "Acme Corp")

    async def test_a_new_name_is_created(self):
        service, _, tenants, users = _tenant_service(exists=False)
        tenant, admin = await _create(service)
        self.assertEqual(tenant.name, "Acme Corp")
        users.add.assert_called_once()

    async def test_losing_a_race_on_the_unique_index_is_a_conflict(self):
        service, session, tenants, _ = _tenant_service(exists=False)
        tenants.flush.side_effect = _integrity_error()
        with self.assertRaises(ConflictError) as ctx:
            await _create(service)
        self.assertEqual(ctx.exception.public_message, ORG_NAME_TAKEN_MESSAGE)
        session.rollback.assert_awaited_once()

    async def test_other_integrity_errors_are_not_disguised(self):
        service, session, tenants, _ = _tenant_service(exists=False)
        tenants.flush.side_effect = _integrity_error("some_other_constraint")
        with self.assertRaises(IntegrityError):
            await _create(service)
        session.rollback.assert_not_awaited()


def _platform_service(tenant, *, name_taken=False, commit_error=None):
    session = AsyncMock()
    if commit_error is not None:
        session.commit.side_effect = commit_error
    tenants = MagicMock()
    tenants.get_by_id = AsyncMock(return_value=tenant)
    tenants.name_exists = AsyncMock(return_value=name_taken)
    tenants.refresh = AsyncMock()
    # A rename also carries the new name to the email settings; give it a row to update.
    settings = MagicMock()
    settings.get_or_create = AsyncMock(return_value=SimpleNamespace(company_name=tenant.name))
    service = PlatformTenantService(
        session,
        tenant_repo=tenants,
        user_repo=MagicMock(),
        tenant_service=MagicMock(),
        audit_service=AsyncMock(),
        gst_documents=MagicMock(),
        refresh_token_repo=MagicMock(),
        settings_repo=settings,
        password_service=MagicMock(),
        mailer=MagicMock(),
    )
    return service, session, tenants


def _tenant(name="Acme Corp"):
    return Tenant(
        id=uuid.uuid4(), name=name, slug="acme", is_active=True,
        verification_status="approved", created_at=datetime.now(timezone.utc),
    )


def _actor():
    return User(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="root@p.example.com",
        full_name="Root", hashed_password="x", role="superadmin", is_active=True,
    )


class RenameTenantTests(unittest.IsolatedAsyncioTestCase):
    async def test_renaming_to_another_orgs_name_is_rejected(self):
        tenant = _tenant()
        service, session, tenants = _platform_service(tenant, name_taken=True)
        with self.assertRaises(ConflictError):
            await service.update_tenant(tenant.id, TenantUpdateRequest(name="Globex"), _actor())
        tenants.name_exists.assert_awaited_once_with("Globex", exclude_id=tenant.id)
        self.assertEqual(tenant.name, "Acme Corp")
        session.commit.assert_not_awaited()

    async def test_recasing_its_own_name_is_allowed(self):
        tenant = _tenant()
        service, session, tenants = _platform_service(tenant, name_taken=True)
        await service.update_tenant(tenant.id, TenantUpdateRequest(name="ACME  CORP"), _actor())
        tenants.name_exists.assert_not_awaited()  # same identity: nothing to check
        self.assertEqual(tenant.name, "ACME CORP")
        session.commit.assert_awaited_once()

    async def test_renaming_to_a_free_name_succeeds(self):
        tenant = _tenant()
        service, session, _ = _platform_service(tenant, name_taken=False)
        await service.update_tenant(tenant.id, TenantUpdateRequest(name="Initech"), _actor())
        self.assertEqual(tenant.name, "Initech")

    async def test_losing_a_race_while_renaming_is_a_conflict(self):
        tenant = _tenant()
        service, session, _ = _platform_service(
            tenant, name_taken=False, commit_error=_integrity_error()
        )
        with self.assertRaises(ConflictError):
            await service.update_tenant(tenant.id, TenantUpdateRequest(name="Initech"), _actor())
        session.rollback.assert_awaited_once()

    async def test_updating_other_fields_does_not_touch_the_name_check(self):
        tenant = _tenant()
        service, _, tenants = _platform_service(tenant)
        await service.update_tenant(tenant.id, TenantUpdateRequest(is_active=True), _actor())
        tenants.name_exists.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
