"""HTTP surface of extension detection: access control and payload validation."""

import unittest
import uuid
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.dependencies import get_current_user, get_integrity_service
from app.main import app
from app.models.models import User
from app.schemas.integrity import IntegrityScanAck


def _user(role: str) -> User:
    return User(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), email=f"{role}@example.com",
        full_name=role, hashed_password="x", role=role, is_active=True,
    )


class _FakeIntegrity:
    def __init__(self):
        self.record_scan = AsyncMock(return_value=IntegrityScanAck(outcome="clear"))
        self.admin_policy = AsyncMock()
        self.list_blocklist = AsyncMock(return_value=[])


class IntegrityEndpointTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _client(self, role=None, fake=None):
        if role:
            app.dependency_overrides[get_current_user] = lambda: _user(role)
        app.dependency_overrides[get_integrity_service] = lambda: fake or _FakeIntegrity()
        return TestClient(app)

    def test_platform_policy_and_blocklist_are_super_admin_only(self):
        for role in ("hr", "admin"):
            client = self._client(role)
            self.assertEqual(client.get("/api/platform/extension-policy").status_code, 403, role)
            self.assertEqual(client.get("/api/platform/extension-blocklist").status_code, 403, role)
            self.assertEqual(
                client.post(
                    "/api/platform/extension-blocklist",
                    json={"extension_id": "a" * 32, "name": "x", "reason": "y"},
                ).status_code,
                403,
                role,
            )
            app.dependency_overrides.clear()

    def test_blocklist_entry_with_a_malformed_id_is_a_422(self):
        client = self._client("superadmin")
        response = client.post(
            "/api/platform/extension-blocklist",
            json={"extension_id": "not-an-id", "name": "x", "reason": "y"},
        )
        self.assertEqual(response.status_code, 422)

    def test_scan_post_validates_and_forwards(self):
        fake = _FakeIntegrity()
        client = self._client(fake=fake)
        with patch("app.routers.interviews.enforce_public_interview_rate_limit", new=AsyncMock()):
            ok = client.post(
                "/api/interview/some-token/integrity-scan",
                json={"phase": "final", "scan_completed": True, "flagged": []},
            )
            bad = client.post(
                "/api/interview/some-token/integrity-scan",
                json={"phase": "nowhere", "scan_completed": True},
            )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["outcome"], "clear")
        fake.record_scan.assert_awaited_once()
        self.assertEqual(bad.status_code, 422)

    def test_scan_post_is_rate_limited_per_token(self):
        fake = _FakeIntegrity()
        client = self._client(fake=fake)
        limiter = AsyncMock()
        with patch("app.routers.interviews.enforce_public_interview_rate_limit", new=limiter):
            client.post(
                "/api/interview/tok-1/integrity-scan",
                json={"phase": "start", "scan_completed": True},
            )
        limiter.assert_awaited_once_with("tok-1", "integrity_scan")


if __name__ == "__main__":
    unittest.main()
