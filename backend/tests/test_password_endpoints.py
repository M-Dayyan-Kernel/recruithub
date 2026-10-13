"""HTTP surface of the password flows: non-enumeration and request validation."""

import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.dependencies import get_auth_service
from app.exceptions import NotFoundError
from app.main import app
from app.schemas.schemas import (
    ChangePasswordRequest,
    ResetPasswordRequest,
    TenantCreateRequest,
)
from app.services.password_service import ResetEmail
from pydantic import ValidationError as PydanticValidationError


class _FakeAuth:
    def __init__(self, pending=None):
        self.pending = pending
        self.reset_password = AsyncMock()

    async def forgot_password(self, body, request):
        return self.pending

    async def get_password_token(self, token, request):
        raise NotFoundError(public_message="This link is invalid or has expired. Request a new one.")


class ForgotPasswordEndpointTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _post(self, fake):
        app.dependency_overrides[get_auth_service] = lambda: fake
        with patch("app.routers.auth.send_password_reset_email", new=AsyncMock()) as mail:
            response = TestClient(app).post(
                "/api/auth/forgot-password", json={"email": "someone@example.com"}
            )
        return response, mail

    def test_response_is_identical_for_known_and_unknown_addresses(self):
        known = ResetEmail(
            to_email="someone@example.com",
            full_name="Some One",
            reset_url="https://hr.example.com/reset-password?token=t",
            expires_minutes=60,
        )
        hit, mail_hit = self._post(_FakeAuth(pending=known))
        miss, mail_miss = self._post(_FakeAuth(pending=None))

        self.assertEqual(hit.status_code, 200)
        self.assertEqual(miss.status_code, 200)
        self.assertEqual(hit.json(), miss.json())

    def test_mail_is_sent_only_when_there_is_something_to_send(self):
        known = ResetEmail("someone@example.com", "Some One", "https://x/y?token=t", 60)
        _, mail_hit = self._post(_FakeAuth(pending=known))
        _, mail_miss = self._post(_FakeAuth(pending=None))
        mail_hit.assert_awaited_once()
        mail_miss.assert_not_awaited()

    def test_malformed_email_is_rejected(self):
        app.dependency_overrides[get_auth_service] = lambda: _FakeAuth()
        response = TestClient(app).post("/api/auth/forgot-password", json={"email": "nope"})
        self.assertEqual(response.status_code, 422)

    def test_invalid_token_lookup_is_a_404(self):
        app.dependency_overrides[get_auth_service] = lambda: _FakeAuth()
        response = TestClient(app).get("/api/auth/password-token/not-a-real-token")
        self.assertEqual(response.status_code, 404)

    def test_change_password_requires_authentication(self):
        response = TestClient(app).post(
            "/api/auth/change-password",
            json={"current_password": "x", "new_password": "Brand-New-Passw0rd!y"},
        )
        self.assertIn(response.status_code, (401, 403))


class SchemaTests(unittest.TestCase):
    def test_reset_and_change_enforce_password_strength(self):
        with self.assertRaises(PydanticValidationError):
            ResetPasswordRequest(token="x" * 20, password="short")
        with self.assertRaises(PydanticValidationError):
            ChangePasswordRequest(current_password="a", new_password="alllowercaseandlong")
        ok = ResetPasswordRequest(token="x" * 20, password="Brand-New-Passw0rd!y")
        self.assertEqual(ok.password, "Brand-New-Passw0rd!y")

    def test_org_create_password_is_optional_but_validated_when_present(self):
        body = TenantCreateRequest(
            name="Acme", admin_email="ada@acme-corp.com", admin_full_name="Ada"
        )
        self.assertIsNone(body.admin_password)
        with self.assertRaises(PydanticValidationError):
            TenantCreateRequest(
                name="Acme",
                admin_email="ada@acme-corp.com",
                admin_full_name="Ada",
                admin_password="weak",
            )


if __name__ == "__main__":
    unittest.main()
