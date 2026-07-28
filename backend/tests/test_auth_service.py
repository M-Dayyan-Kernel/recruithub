"""TenantAccessPolicy tests."""

import unittest
from unittest.mock import MagicMock

from app.exceptions import AuthorizationError, BadRequestError
from app.services.tenant_access_policy import TenantAccessPolicy


class TenantAccessPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = TenantAccessPolicy()

    def test_pending_tenant_raises(self):
        tenant = MagicMock()
        tenant.verification_status = "pending"
        tenant.is_active = False
        with self.assertRaises(AuthorizationError):
            self.policy.assert_can_access(tenant)

    def test_rejected_tenant_raises(self):
        tenant = MagicMock()
        tenant.verification_status = "rejected"
        tenant.is_active = False
        with self.assertRaises(AuthorizationError):
            self.policy.assert_can_access(tenant)

    def test_inactive_tenant_raises(self):
        tenant = MagicMock()
        tenant.verification_status = "approved"
        tenant.is_active = False
        with self.assertRaises(AuthorizationError):
            self.policy.assert_can_access(tenant)

    def test_approved_active_passes(self):
        tenant = MagicMock()
        tenant.verification_status = "approved"
        tenant.is_active = True
        self.policy.assert_can_access(tenant)

    def test_switch_to_unapproved_raises(self):
        tenant = MagicMock()
        tenant.verification_status = "pending"
        tenant.is_active = True
        with self.assertRaises(AuthorizationError):
            self.policy.assert_can_switch_to(tenant)

    def test_switch_to_inactive_raises_bad_request(self):
        tenant = MagicMock()
        tenant.verification_status = "approved"
        tenant.is_active = False
        with self.assertRaises(BadRequestError):
            self.policy.assert_can_switch_to(tenant)


if __name__ == "__main__":
    unittest.main()
