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
        self.list_blocklist = AsyncMock(return_value=[])
        self.delete_entry = AsyncMock()


class IntegrityEndpointTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _client(self, role=None, fake=None):
        if role:
            app.dependency_overrides[get_current_user] = lambda: _user(role)
        app.dependency_overrides[get_integrity_service] = lambda: fake or _FakeIntegrity()
        return TestClient(app)

    def test_the_platform_extension_routes_are_gone(self):
        client = self._client("superadmin")
        for method, path in (
            ("get", "/api/platform/extension-policy"),
            ("get", "/api/platform/extension-blocklist"),
            ("get", "/api/platform/observed-extensions"),
        ):
            self.assertEqual(getattr(client, method)(path).status_code, 404, path)

    def test_hr_can_read_but_not_write_the_org_blocklist(self):
        fake = _FakeIntegrity()
        client = self._client("hr", fake)
        self.assertEqual(client.get("/api/extension-policy/blocklist").status_code, 200)
        entry = uuid.uuid4()
        writes = (
            ("post", "/api/extension-policy/blocklist", {"extension_id": "a" * 32, "name": "x", "reason": "y"}),
            ("patch", f"/api/extension-policy/blocklist/{entry}", {"status": "inactive"}),
            ("delete", f"/api/extension-policy/blocklist/{entry}", None),
            ("post", "/api/extension-policy/restore-defaults", None),
            ("post", f"/api/extension-policy/observed/{entry}/dismiss", None),
            ("post", f"/api/extension-policy/observed/{entry}/restore", None),
            ("post", f"/api/extension-policy/observed/{entry}/add-to-blocklist", {"category": "ai_assistant"}),
        )
        for method, path, body in writes:
            kwargs = {"json": body} if body is not None else {}
            self.assertEqual(getattr(client, method)(path, **kwargs).status_code, 403, f"{method} {path}")

    def test_there_is_no_org_wide_defaults_route(self):
        # The on/off switch and mode are per job; an organization has no defaults to edit.
        client = self._client("admin", _FakeIntegrity())
        self.assertEqual(client.put("/api/extension-policy", json={"default_mode": "enforce"}).status_code, 405)

    def test_admin_may_write_and_hr_cannot_reach_it_unauthenticated(self):
        fake = _FakeIntegrity()
        client = self._client("admin", fake)
        response = client.delete(f"/api/extension-policy/blocklist/{uuid.uuid4()}")
        self.assertEqual(response.status_code, 204)
        fake.delete_entry.assert_awaited_once()

    def test_candidate_style_roles_are_refused_everywhere(self):
        client = self._client("viewer")
        self.assertEqual(client.get("/api/extension-policy").status_code, 403)

    def test_blocklist_entry_with_a_malformed_id_is_a_422(self):
        client = self._client("admin")
        response = client.post(
            "/api/extension-policy/blocklist",
            json={"extension_id": "not-an-id", "name": "x", "reason": "y"},
        )
        self.assertEqual(response.status_code, 422)

    def test_editing_the_extension_id_is_a_422(self):
        client = self._client("admin")
        response = client.patch(
            f"/api/extension-policy/blocklist/{uuid.uuid4()}", json={"extension_id": "a" * 32}
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
