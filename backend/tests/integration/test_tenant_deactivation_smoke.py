"""A disabled organization must surface `error_code` so the UI can sign out."""

import unittest

from fastapi import Depends
from fastapi.testclient import TestClient

from app.exceptions import AuthorizationError
from app.main import app
from app.services.tenant_access_policy import (
    ORG_INACTIVE_CODE,
    ORG_INACTIVE_MESSAGE,
    TenantAccessPolicy,
)

_ROUTE = "/__test__/inactive-org"
_PLAIN_ROUTE = "/__test__/forbidden"


async def _reject_like_get_current_user():
    """Mirrors the dependency that guards every authenticated route."""
    TenantAccessPolicy().assert_can_access(
        type("T", (), {"verification_status": "approved", "is_active": False})()
    )


async def _reject_without_code():
    raise AuthorizationError(public_message="Insufficient permissions")


class TenantDeactivationResponseTests(unittest.TestCase):
    """The error code has to survive the dependency -> handler -> JSON trip.

    Auth dependencies used to translate DomainError into HTTPException, which
    has nowhere to carry a code, so the client saw a bare 403 and left the user
    sitting on a broken page.
    """

    @classmethod
    def setUpClass(cls):
        cls._routes = []
        for path, dep in (
            (_ROUTE, _reject_like_get_current_user),
            (_PLAIN_ROUTE, _reject_without_code),
        ):
            app.get(path, dependencies=[Depends(dep)])(lambda: {"ok": True})
            cls._routes.append(app.router.routes[-1])

    @classmethod
    def tearDownClass(cls):
        for route in cls._routes:
            app.router.routes.remove(route)

    def setUp(self):
        self.client = TestClient(app)

    def test_dependency_failure_carries_error_code(self):
        response = self.client.get(_ROUTE)
        self.assertEqual(response.status_code, 403)
        body = response.json()
        self.assertEqual(body["error_code"], ORG_INACTIVE_CODE)
        self.assertEqual(body["detail"], ORG_INACTIVE_MESSAGE)

    def test_plain_forbidden_keeps_bare_detail_shape(self):
        """Codes are opt-in, so an ordinary 403 must not gain one — otherwise
        every permission error would log the user out."""
        response = self.client.get(_PLAIN_ROUTE)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("error_code", response.json())


if __name__ == "__main__":
    unittest.main()
