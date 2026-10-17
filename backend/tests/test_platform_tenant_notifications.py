"""Org onboarding / approval / rejection notify the organization admin."""

import unittest
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.models.models import Tenant, User
from app.schemas.schemas import TenantCreateRequest
from app.services.platform_tenant_service import PlatformTenantService


def _tenant(status="pending", active=False):
    return Tenant(
        id=uuid.uuid4(),
        name="Acme",
        slug="acme",
        is_active=active,
        verification_status=status,
        created_at=datetime.now(timezone.utc),
    )


def _org_admin(tenant):
    return User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email="ada@acme-corp.com",
        full_name="Ada",
        hashed_password="x",
        role="admin",
        is_active=True,
    )


def _build(tenant, org_admin, *, mail_ok=True):
    session = AsyncMock()
    tenants = MagicMock()
    tenants.get_by_id = AsyncMock(return_value=tenant)
    tenants.refresh = AsyncMock()
    users = MagicMock()
    users.exists_by_email = AsyncMock(return_value=False)
    users.get_first_admin = AsyncMock(return_value=org_admin)
    tenant_service = MagicMock()
    tenant_service.create_tenant_with_admin = AsyncMock(return_value=(tenant, org_admin))
    passwords = MagicMock()
    passwords.issue_token = AsyncMock(return_value="onboarding-raw-token")
    refresh = MagicMock()
    refresh.revoke_all_for_tenant = AsyncMock(return_value=0)
    mailer = MagicMock()
    for name in (
        "send_org_onboarding_email",
        "send_org_approved_email",
        "send_org_rejected_email",
    ):
        setattr(mailer, name, AsyncMock(return_value=mail_ok))
    service = PlatformTenantService(
        session,
        tenant_repo=tenants,
        user_repo=users,
        tenant_service=tenant_service,
        audit_service=AsyncMock(),
        gst_documents=MagicMock(),
        refresh_token_repo=refresh,
        password_service=passwords,
        mailer=mailer,
    )
    return service, session, tenant_service, passwords, mailer


def _actor():
    return User(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="root@p.test",
        full_name="Root", hashed_password="x", role="superadmin", is_active=True,
    )


class CreateTenantTests(unittest.IsolatedAsyncioTestCase):
    def _body(self, **kw):
        return TenantCreateRequest(
            name="Acme", admin_email="ada@acme-corp.com", admin_full_name="Ada", **kw
        )

    async def test_without_a_password_an_unusable_one_is_provisioned_and_a_link_is_sent(self):
        tenant = _tenant("approved", True)
        service, session, tenant_service, passwords, mailer = _build(tenant, _org_admin(tenant))

        result = await service.create_tenant(self._body(), _actor())

        used_password = tenant_service.create_tenant_with_admin.await_args.kwargs["password"]
        self.assertGreaterEqual(len(used_password), 40)
        passwords.issue_token.assert_awaited_once()
        self.assertEqual(passwords.issue_token.await_args.args[1], "onboarding")

        kwargs = mailer.send_org_onboarding_email.await_args.kwargs
        self.assertIn("token=onboarding-raw-token", kwargs["set_password_url"])
        self.assertEqual(kwargs["expires_days"], 7)
        self.assertTrue(result.email_sent)

    async def test_token_is_issued_before_commit_and_mail_after(self):
        tenant = _tenant("approved", True)
        service, session, _, passwords, mailer = _build(tenant, _org_admin(tenant))
        order = []
        passwords.issue_token.side_effect = lambda *a, **k: order.append("token") or "t"
        session.commit.side_effect = lambda: order.append("commit")
        mailer.send_org_onboarding_email.side_effect = (
            lambda *a, **k: order.append("mail") or True
        )

        await service.create_tenant(self._body(), _actor())

        self.assertEqual(order, ["token", "commit", "mail"])

    async def test_a_supplied_password_is_still_accepted(self):
        tenant = _tenant("approved", True)
        service, _, tenant_service, _, _ = _build(tenant, _org_admin(tenant))
        await service.create_tenant(self._body(admin_password="Sup3r-Secret-Passw0rd!"), _actor())
        self.assertEqual(
            tenant_service.create_tenant_with_admin.await_args.kwargs["password"],
            "Sup3r-Secret-Passw0rd!",
        )

    async def test_mail_failure_does_not_fail_onboarding(self):
        tenant = _tenant("approved", True)
        service, session, _, _, _ = _build(tenant, _org_admin(tenant), mail_ok=False)
        result = await service.create_tenant(self._body(), _actor())
        self.assertFalse(result.email_sent)
        session.commit.assert_awaited()


class ApproveRejectTests(unittest.IsolatedAsyncioTestCase):
    async def test_approval_notifies_the_org_admin_with_a_login_link(self):
        tenant = _tenant("pending", False)
        service, _, _, _, mailer = _build(tenant, _org_admin(tenant))
        result = await service.approve_tenant(tenant.id, _actor())
        kwargs = mailer.send_org_approved_email.await_args
        self.assertEqual(kwargs.args[0], "ada@acme-corp.com")
        self.assertTrue(kwargs.kwargs["login_url"].endswith("/login"))
        self.assertTrue(result.email_sent)

    async def test_re_approving_an_approved_org_sends_nothing(self):
        tenant = _tenant("approved", True)
        service, _, _, _, mailer = _build(tenant, _org_admin(tenant))
        result = await service.approve_tenant(tenant.id, _actor())
        mailer.send_org_approved_email.assert_not_awaited()
        self.assertIsNone(result.email_sent)

    async def test_rejection_notifies_without_a_login_link(self):
        tenant = _tenant("pending", False)
        service, _, _, _, mailer = _build(tenant, _org_admin(tenant))
        result = await service.reject_tenant(tenant.id, _actor())
        mailer.send_org_rejected_email.assert_awaited_once()
        self.assertNotIn("login_url", mailer.send_org_rejected_email.await_args.kwargs)
        self.assertTrue(result.email_sent)

    async def test_repeat_rejection_sends_nothing(self):
        tenant = _tenant("rejected", False)
        service, _, _, _, mailer = _build(tenant, _org_admin(tenant))
        await service.reject_tenant(tenant.id, _actor())
        mailer.send_org_rejected_email.assert_not_awaited()

    async def test_org_without_an_admin_reports_email_not_sent(self):
        tenant = _tenant("pending", False)
        service, _, _, _, mailer = _build(tenant, None)
        result = await service.approve_tenant(tenant.id, _actor())
        mailer.send_org_approved_email.assert_not_awaited()
        self.assertIs(result.email_sent, False)

    async def test_mail_failure_does_not_undo_the_decision(self):
        tenant = _tenant("pending", False)
        service, session, _, _, _ = _build(tenant, _org_admin(tenant), mail_ok=False)
        result = await service.approve_tenant(tenant.id, _actor())
        self.assertEqual(result.verification_status, "approved")
        self.assertFalse(result.email_sent)
        session.commit.assert_awaited()
