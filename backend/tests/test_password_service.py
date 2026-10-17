"""PasswordService: link lifecycle, reset, and authenticated change."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

from app.core.constants import (
    PASSWORD_ONBOARDING_TTL_DAYS,
    PASSWORD_RESET_TTL_MINUTES,
)
from app.core.security import hash_password, verify_password
from app.exceptions import BadRequestError, NotFoundError
from app.models.models import PasswordToken, Tenant, User
from app.repositories.password_token_repository import (
    PasswordTokenRepository,
    hash_password_token,
)
from app.services.password_service import (
    PURPOSE_ONBOARDING,
    PURPOSE_RESET,
    PasswordService,
)

CURRENT = "Current-Passw0rd!x"
NEW = "Brand-New-Passw0rd!y"
# bcrypt is deliberately slow; hash once, not per test.
_CURRENT_HASH = hash_password(CURRENT)


def _user(*, active=True, role="admin", tenant_status="approved", tenant_active=True):
    tenant = Tenant(
        id=uuid.uuid4(),
        name="Acme",
        slug="acme",
        is_active=tenant_active,
        verification_status=tenant_status,
    )
    user = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email="admin@acme.test",
        full_name="Ada Admin",
        hashed_password=_CURRENT_HASH,
        role=role,
        is_active=active,
    )
    user.tenant = tenant
    return user


def _service(user=None, *, issued_recently=False, consume=None):
    session = AsyncMock()
    users = MagicMock()
    users.get_by_email = AsyncMock(return_value=user)
    users.get_by_id = AsyncMock(return_value=user)

    tokens = MagicMock()
    tokens.invalidate_unused_for_user = AsyncMock(return_value=0)
    tokens.issued_since = AsyncMock(return_value=issued_recently)
    tokens.consume = AsyncMock(return_value=consume)
    tokens.get_valid_by_hash = AsyncMock(return_value=None)
    tokens.flush = AsyncMock()
    created = []

    def create(user_id, purpose, ttl, **kw):
        # Use the real repository so the raw/hash contract is exercised.
        row, raw = PasswordTokenRepository(MagicMock()).create(user_id, purpose, ttl)
        created.append((row, raw, purpose, ttl))
        return row, raw

    tokens.create = create

    refresh = MagicMock()
    refresh.revoke_all_for_user = AsyncMock(return_value=2)

    service = PasswordService(
        session, user_repo=users, token_repo=tokens, refresh_repo=refresh
    )
    return service, session, tokens, refresh, created


class IssueTokenTests(unittest.IsolatedAsyncioTestCase):
    async def test_onboarding_link_lasts_days_and_retires_earlier_links(self):
        user = _user()
        service, _, tokens, _, created = _service(user)

        raw = await service.issue_token(user, PURPOSE_ONBOARDING)

        tokens.invalidate_unused_for_user.assert_awaited_once_with(user.id)
        row, stored_raw, purpose, ttl = created[0]
        self.assertEqual(raw, stored_raw)
        self.assertEqual(purpose, "onboarding")
        self.assertEqual(ttl, timedelta(days=PASSWORD_ONBOARDING_TTL_DAYS))

    async def test_reset_link_is_short_lived(self):
        user = _user()
        service, _, _, _, created = _service(user)
        await service.issue_token(user, PURPOSE_RESET)
        self.assertEqual(created[0][3], timedelta(minutes=PASSWORD_RESET_TTL_MINUTES))

    async def test_only_a_hash_is_stored(self):
        user = _user()
        service, _, _, _, created = _service(user)
        raw = await service.issue_token(user, PURPOSE_RESET)
        row = created[0][0]
        self.assertNotEqual(row.token_hash, raw)
        self.assertEqual(row.token_hash, hash_password_token(raw))
        self.assertEqual(len(row.token_hash), 64)


class RequestResetTests(unittest.IsolatedAsyncioTestCase):
    async def test_known_active_user_gets_an_email(self):
        user = _user()
        service, session, _, _, created = _service(user)

        pending = await service.request_reset("admin@acme.test")

        self.assertIsNotNone(pending)
        self.assertEqual(pending.to_email, "admin@acme.test")
        self.assertIn("/reset-password?token=", pending.reset_url)
        self.assertIn(created[0][1], pending.reset_url)
        self.assertEqual(pending.expires_minutes, PASSWORD_RESET_TTL_MINUTES)
        session.commit.assert_awaited_once()

    async def test_no_email_for_unknown_inactive_or_blocked_accounts(self):
        cases = {
            "unknown": None,
            "inactive user": _user(active=False),
            "pending org": _user(tenant_status="pending", tenant_active=False),
            "rejected org": _user(tenant_status="rejected", tenant_active=False),
            "deactivated org": _user(tenant_active=False),
        }
        for label, user in cases.items():
            service, session, tokens, _, created = _service(user)
            self.assertIsNone(await service.request_reset("x@acme.test"), label)
            self.assertEqual(created, [], label)
            session.commit.assert_not_awaited()

    async def test_superadmin_is_not_blocked_by_tenant_state(self):
        user = _user(role="superadmin", tenant_status="pending", tenant_active=False)
        service, _, _, _, _ = _service(user)
        self.assertIsNotNone(await service.request_reset("root@platform.test"))

    async def test_recent_request_is_not_repeated(self):
        service, session, _, _, created = _service(_user(), issued_recently=True)
        self.assertIsNone(await service.request_reset("admin@acme.test"))
        self.assertEqual(created, [])
        session.commit.assert_not_awaited()


class ResetPasswordTests(unittest.IsolatedAsyncioTestCase):
    async def test_valid_token_sets_password_and_revokes_sessions(self):
        user = _user()
        service, session, tokens, refresh, _ = _service(
            user, consume=(user.id, PURPOSE_RESET)
        )

        await service.reset_password("raw-token-value-1234", NEW)

        tokens.consume.assert_awaited_once_with(hash_password_token("raw-token-value-1234"))
        self.assertTrue(verify_password(NEW, user.hashed_password))
        refresh.revoke_all_for_user.assert_awaited_once_with(user.id)
        tokens.invalidate_unused_for_user.assert_awaited_once_with(user.id)
        session.commit.assert_awaited_once()

    async def test_unknown_expired_or_used_token_is_rejected(self):
        user = _user()
        service, session, _, refresh, _ = _service(user, consume=None)
        with self.assertRaises(NotFoundError):
            await service.reset_password("raw-token-value-1234", NEW)
        refresh.revoke_all_for_user.assert_not_awaited()
        session.commit.assert_not_awaited()
        self.assertTrue(verify_password(CURRENT, user.hashed_password))

    async def test_token_for_an_inactive_user_is_rejected(self):
        user = _user(active=False)
        service, session, _, _, _ = _service(user, consume=(user.id, PURPOSE_RESET))
        with self.assertRaises(NotFoundError):
            await service.reset_password("raw-token-value-1234", NEW)
        session.commit.assert_not_awaited()


class DescribeTokenTests(unittest.IsolatedAsyncioTestCase):
    async def test_valid_token_reports_email_and_purpose(self):
        user = _user()
        service, _, tokens, _, _ = _service(user)
        tokens.get_valid_by_hash = AsyncMock(
            return_value=PasswordToken(user_id=user.id, purpose="onboarding")
        )
        info = await service.describe_token("raw-token-value-1234")
        self.assertEqual((info.email, info.purpose), ("admin@acme.test", "onboarding"))

    async def test_invalid_token_is_not_found(self):
        service, _, _, _, _ = _service(_user())
        with self.assertRaises(NotFoundError):
            await service.describe_token("raw-token-value-1234")


class ChangePasswordTests(unittest.IsolatedAsyncioTestCase):
    async def test_wrong_current_password_is_a_400_not_a_401(self):
        user = _user()
        service, _, _, refresh, _ = _service(user)
        with self.assertRaises(BadRequestError) as ctx:
            await service.change_password(
                user, current_password="nope-nope-nope", new_password=NEW
            )
        self.assertEqual(ctx.exception.status_code, 400)
        refresh.revoke_all_for_user.assert_not_awaited()
        self.assertTrue(verify_password(CURRENT, user.hashed_password))

    async def test_new_password_must_differ(self):
        user = _user()
        service, _, _, _, _ = _service(user)
        with self.assertRaises(BadRequestError):
            await service.change_password(
                user, current_password=CURRENT, new_password=CURRENT
            )

    async def test_success_changes_hash_and_revokes_every_session(self):
        user = _user()
        service, _, tokens, refresh, _ = _service(user)
        await service.change_password(user, current_password=CURRENT, new_password=NEW)
        self.assertTrue(verify_password(NEW, user.hashed_password))
        refresh.revoke_all_for_user.assert_awaited_once_with(user.id)
        tokens.invalidate_unused_for_user.assert_awaited_once_with(user.id)
