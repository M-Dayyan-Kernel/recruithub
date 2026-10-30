"""Observed-extensions catalog: sightings, dismissal memory, per-organization isolation."""

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient
from pydantic import ValidationError as PydanticValidationError

from app.dependencies import get_current_user, get_observed_extension_service
from app.exceptions import NotFoundError
from app.main import app
from app.models.models import ObservedExtension, User
from app.schemas.integrity import FlaggedExtensionIn, IntegrityScanIn
from app.services.integrity_service import IntegrityService
from app.services.observed_extension_service import (
    MAX_KNOWN_HASHES,
    ObservedExtensionService,
    content_hash,
    listing_url,
    observe,
)

NOW = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)
LATER = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)
EXT = "a" * 32
TENANT = uuid.uuid4()


def _row(**over):
    base = dict(
        id=uuid.uuid4(), extension_id=EXT, name="AI Notes", description="Notes with AI",
        strongest_reason="heuristic_weak", times_seen=0, first_seen_at=NOW, last_seen_at=NOW,
        status="new", content_hash="", known_hashes=[], dismissed_hash=None,
        dismissed_reason=None, dismissed_at=None, dismissed_by_user_id=None, reopened_reason=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


def _see(row, *, name="AI Notes", description="Notes with AI", reason="heuristic_weak", now=LATER):
    return observe(row, name=name, description=description, reason=reason, now=now)


def _dismissed_row():
    row = _row()
    _see(row)
    row.status = "dismissed"
    row.dismissed_hash = row.content_hash
    row.dismissed_reason = row.strongest_reason
    return row


# ── observe(): the dismissal rules ──────────────────────────────────────────


class ObserveTests(unittest.TestCase):
    def test_a_sighting_moves_count_and_last_seen(self):
        row = _row()
        self.assertIsNone(_see(row))
        self.assertEqual((row.times_seen, row.last_seen_at), (1, LATER))
        _see(row)
        self.assertEqual(row.times_seen, 2)

    def test_strongest_reason_only_goes_up(self):
        row = _row()
        _see(row, reason="heuristic_strong")
        _see(row, reason="heuristic_weak")
        self.assertEqual(row.strongest_reason, "heuristic_strong")

    def test_dismissed_stays_dismissed_however_often_it_is_seen(self):
        row = _dismissed_row()
        for _ in range(50):
            self.assertIsNone(_see(row))
        self.assertEqual(row.status, "dismissed")
        self.assertEqual(row.times_seen, 51)

    def test_changed_content_reopens(self):
        row = _dismissed_row()
        reopened = _see(row, description="Now an AI writing assistant")
        self.assertEqual(reopened, "content_changed")
        self.assertEqual((row.status, row.reopened_reason), ("new", "content_changed"))

    def test_a_stronger_match_reopens(self):
        row = _dismissed_row()
        reopened = _see(row, reason="heuristic_strong")
        self.assertEqual(reopened, "stronger_match")
        self.assertEqual(row.status, "new")

    def test_a_sighting_without_description_is_not_a_change(self):
        # Older extension installs report no description. That is "no information",
        # not "the description was removed", or the row would flap with the install base.
        row = _dismissed_row()
        self.assertIsNone(_see(row, description=None))
        self.assertEqual(row.status, "dismissed")
        self.assertEqual(row.description, "Notes with AI")

    def test_a_variant_seen_before_dismissal_never_reopens_it(self):
        # Chrome localises names and descriptions: another browser language is not a change.
        row = _row()
        _see(row, name="AI Notes", description="Notes with AI")
        _see(row, name="KI-Notizen", description="Notizen mit KI")
        row.status = "dismissed"
        row.dismissed_hash = row.content_hash
        row.dismissed_reason = row.strongest_reason
        self.assertIsNone(_see(row, name="AI Notes", description="Notes with AI"))
        self.assertIsNone(_see(row, name="KI-Notizen", description="Notizen mit KI"))
        self.assertEqual(row.status, "dismissed")
        # A variant never seen does reopen it.
        self.assertEqual(
            _see(row, name="Notes IA", description="Notes avec IA"), "content_changed"
        )

    def test_remembered_variants_are_capped(self):
        row = _row()
        for i in range(MAX_KNOWN_HASHES + 10):
            _see(row, description=f"variant {i}")
        self.assertEqual(len(row.known_hashes), MAX_KNOWN_HASHES)
        self.assertEqual(row.known_hashes[-1], content_hash("AI Notes", f"variant {MAX_KNOWN_HASHES + 9}"))

    def test_new_rows_never_report_a_reopen(self):
        row = _row()
        self.assertIsNone(_see(row, description="a"))
        self.assertIsNone(_see(row, description="b", reason="heuristic_strong"))


class HelperTests(unittest.TestCase):
    def test_content_hash_ignores_case_and_spacing(self):
        self.assertEqual(content_hash("AI  Notes", " Notes\nwith AI"), content_hash("ai notes", "notes with ai"))
        self.assertNotEqual(content_hash("AI Notes", "a"), content_hash("AI Notes", "b"))
        self.assertEqual(content_hash("x", None), content_hash("x", ""))

    def test_store_link_only_for_real_chrome_ids(self):
        self.assertTrue(listing_url(EXT).endswith(f"/{EXT}"))
        self.assertIsNone(listing_url("not-an-id"))
        self.assertIsNone(listing_url("A" * 32))


# ── schema ──────────────────────────────────────────────────────────────────


class DescriptionSchemaTests(unittest.TestCase):
    def _item(self, **kw):
        return FlaggedExtensionIn(id=EXT, name="x", reason_code="heuristic_weak", **kw)

    def test_description_is_tidied_and_truncated_not_rejected(self):
        self.assertEqual(self._item(description="  a \n b  ").description, "a b")
        self.assertEqual(len(self._item(description="x" * 1000).description), 300)

    def test_missing_blank_or_wrong_type_becomes_none(self):
        for value in (None, "", "   ", 42, ["x"]):
            self.assertIsNone(self._item(description=value).description)


# ── service ─────────────────────────────────────────────────────────────────


def _flagged(ext_id=EXT, reason="heuristic_weak", **kw):
    kw.setdefault("description", "Notes with AI")
    return FlaggedExtensionIn(id=ext_id, name="AI Notes", reason_code=reason, **kw)


def _service(rows=None):
    repo = MagicMock()
    repo.ensure_rows = AsyncMock()
    repo.lock_many = AsyncMock(return_value=rows or [])
    repo.get = AsyncMock(return_value=None)
    repo.page = AsyncMock(return_value=([], 0))
    audit = AsyncMock()
    session = AsyncMock()
    return ObservedExtensionService(session, repo=repo, audit=audit), repo, audit, session


def _admin(tenant_id=TENANT):
    return User(
        id=uuid.uuid4(), tenant_id=tenant_id, email="admin@org.example.com",
        full_name="Admin", hashed_password="x", role="admin", is_active=True,
    )


class RecordTests(unittest.IsolatedAsyncioTestCase):
    async def test_known_list_matches_never_enter_the_catalog(self):
        service, repo, _, _ = _service()
        await service.record(TENANT, [_flagged(reason="known_id")])
        repo.ensure_rows.assert_not_awaited()
        repo.lock_many.assert_not_awaited()

    async def test_duplicates_in_one_scan_count_once_and_the_strongest_wins(self):
        row = _row(extension_id=EXT)
        service, repo, _, _ = _service([row])
        await service.record(
            TENANT, [_flagged(reason="heuristic_weak"), _flagged(reason="heuristic_strong")]
        )
        created = repo.ensure_rows.await_args.args[0]
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["strongest_reason"], "heuristic_strong")
        self.assertEqual(row.times_seen, 1)
        self.assertEqual(row.strongest_reason, "heuristic_strong")

    async def test_rows_are_locked_by_id_in_one_call(self):
        service, repo, _, _ = _service([])
        await service.record(TENANT, [_flagged("b" * 32), _flagged("a" * 32)])
        self.assertEqual(repo.lock_many.await_args.args[0], TENANT)
        locked = repo.lock_many.await_args.args[1]
        self.assertEqual(sorted(locked), ["a" * 32, "b" * 32])

    async def test_the_catalog_row_carries_no_candidate_or_interview_fields(self):
        service, repo, _, _ = _service([])
        await service.record(TENANT, [_flagged()])
        created = repo.ensure_rows.await_args.args[0][0]
        # The organization is the only thing a row may point at.
        self.assertEqual(created["tenant_id"], TENANT)
        forbidden = ("candidate", "interview", "job", "session", "user")
        self.assertFalse({k for k in created if any(t in k for t in forbidden)})
        self.assertFalse(
            {c for c in ObservedExtension.__table__.columns.keys()
             if any(t in c for t in forbidden if t != "user")}
        )

    async def test_nothing_flagged_is_a_no_op(self):
        service, repo, _, _ = _service()
        await service.record(TENANT, [])
        repo.ensure_rows.assert_not_awaited()


class AdminActionTests(unittest.IsolatedAsyncioTestCase):
    async def test_dismiss_remembers_what_it_looked_like_and_audits(self):
        row = _row(content_hash="h1", strongest_reason="heuristic_strong")
        row.name = "AI Notes"
        service, repo, audit, session = _service()
        repo.get = AsyncMock(return_value=row)
        admin = _admin()

        result = await service.dismiss(row.id, admin)
        repo.get.assert_awaited_with(admin.tenant_id, row.id)

        self.assertEqual(row.status, "dismissed")
        self.assertEqual((row.dismissed_hash, row.dismissed_reason), ("h1", "heuristic_strong"))
        self.assertEqual(row.dismissed_by_user_id, admin.id)
        self.assertEqual(result.status, "dismissed")
        audit.log_change.assert_awaited_once()
        session.commit.assert_awaited_once()

    async def test_dismissing_twice_logs_once(self):
        row = _row(status="dismissed")
        service, repo, audit, _ = _service()
        repo.get = AsyncMock(return_value=row)
        await service.dismiss(row.id, _admin())
        audit.log_change.assert_not_awaited()

    async def test_restore_clears_the_dismissal(self):
        row = _row(status="dismissed", dismissed_hash="h", dismissed_reason="heuristic_weak",
                   dismissed_by_user_id=uuid.uuid4(), reopened_reason=None)
        service, repo, audit, _ = _service()
        repo.get = AsyncMock(return_value=row)
        await service.restore(row.id, _admin())
        self.assertEqual(row.status, "new")
        self.assertIsNone(row.dismissed_hash)
        self.assertIsNone(row.dismissed_by_user_id)
        audit.log_change.assert_awaited_once()

    async def test_unknown_row_is_not_found(self):
        service, _, _, _ = _service()
        with self.assertRaises(NotFoundError):
            await service.dismiss(uuid.uuid4(), _admin())
        with self.assertRaises(NotFoundError):
            await service.restore(uuid.uuid4(), _admin())


# ── scan recording integration ──────────────────────────────────────────────


def _integrity(*, observed):
    session = AsyncMock()
    session.begin_nested = MagicMock()
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=None)
    ctx.__aexit__ = AsyncMock(return_value=False)
    session.begin_nested.return_value = ctx

    repo = MagicMock()
    repo.add_scan = MagicMock(side_effect=lambda s: s)
    interviews = MagicMock()
    interview = SimpleNamespace(
        id=uuid.uuid4(), status="in_progress", job_id=uuid.uuid4(),
        extension_check_enabled=None, extension_check_mode=None, extension_policy_version=None,
    )
    interviews.get_session_by_token = AsyncMock(return_value=interview)
    job = SimpleNamespace(
        id=interview.job_id, tenant_id=TENANT, extension_check_enabled=True,
        extension_check_mode="shadow",
    )
    session.get = AsyncMock(return_value=job)
    repo.get_org_policy = AsyncMock(
        return_value=SimpleNamespace(version=4, blocklist_seeded_at=NOW, extension_enabled=True)
    )
    service = IntegrityService(
        session, repo=repo, interviews=interviews, audit=AsyncMock(), observed=observed
    )
    return service, session, repo


class ScanRecordingTests(unittest.IsolatedAsyncioTestCase):
    async def test_flagged_items_reach_the_catalog_and_the_scan_omits_the_description(self):
        observed = MagicMock()
        observed.record = AsyncMock()
        service, session, repo = _integrity(observed=observed)
        body = IntegrityScanIn(phase="final", scan_completed=True, flagged=[_flagged()])

        await service.record_scan("tok", body)

        observed.record.assert_awaited_once()
        self.assertEqual(observed.record.await_args.args[0], TENANT)
        stored = repo.add_scan.call_args.args[0]
        self.assertNotIn("description", stored.flagged[0])
        session.commit.assert_awaited()

    async def test_a_catalog_failure_never_costs_the_interview_its_scan(self):
        observed = MagicMock()
        observed.record = AsyncMock(side_effect=RuntimeError("catalog is broken"))
        service, session, repo = _integrity(observed=observed)

        ack = await service.record_scan(
            "tok", IntegrityScanIn(phase="final", scan_completed=True, flagged=[_flagged()])
        )

        self.assertEqual(ack.outcome, "flagged")
        repo.add_scan.assert_called_once()
        session.commit.assert_awaited()

    async def test_clean_scans_do_not_touch_the_catalog(self):
        observed = MagicMock()
        observed.record = AsyncMock()
        service, _, _ = _integrity(observed=observed)
        await service.record_scan("tok", IntegrityScanIn(phase="final", scan_completed=True))
        observed.record.assert_not_awaited()


# ── HTTP ────────────────────────────────────────────────────────────────────


class _FakeCatalog:
    def __init__(self):
        self.list_page = AsyncMock()
        self.dismiss = AsyncMock()
        self.restore = AsyncMock()


class EndpointTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def _client(self, role, fake=None):
        user = User(
            id=uuid.uuid4(), tenant_id=uuid.uuid4(), email=f"{role}@example.com",
            full_name=role, hashed_password="x", role=role, is_active=True,
        )
        self.user = user
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_observed_extension_service] = lambda: fake or _FakeCatalog()
        return TestClient(app)

    def test_hr_may_read_but_only_admins_may_act(self):
        row = uuid.uuid4()
        fake = _FakeCatalog()
        from app.schemas.integrity import ObservedExtensionPage

        fake.list_page.return_value = ObservedExtensionPage(items=[], total=0, limit=20, offset=0)
        client = self._client("hr", fake)
        self.assertEqual(client.get("/api/extension-policy/observed").status_code, 200)
        for action in ("dismiss", "restore"):
            self.assertEqual(
                client.post(f"/api/extension-policy/observed/{row}/{action}").status_code, 403, action
            )

    def test_list_is_scoped_to_the_callers_organization(self):
        from app.schemas.integrity import ObservedExtensionPage

        fake = _FakeCatalog()
        fake.list_page.return_value = ObservedExtensionPage(items=[], total=0, limit=20, offset=0)
        client = self._client("admin", fake)
        client.get("/api/extension-policy/observed")
        self.assertEqual(fake.list_page.await_args.args[0], self.user.tenant_id)

    def test_list_validates_its_query(self):
        client = self._client("admin")
        base = "/api/extension-policy/observed"
        self.assertEqual(client.get(f"{base}?status=bogus").status_code, 422)
        self.assertEqual(client.get(f"{base}?limit=0").status_code, 422)
        self.assertEqual(client.get(f"{base}?limit=101").status_code, 422)
        self.assertEqual(client.get(f"{base}?offset=-1").status_code, 422)

    def test_list_passes_filters_through(self):
        from app.schemas.integrity import ObservedExtensionPage

        fake = _FakeCatalog()
        fake.list_page.return_value = ObservedExtensionPage(items=[], total=0, limit=5, offset=10)
        client = self._client("admin", fake)
        response = client.get("/api/extension-policy/observed?status=dismissed&limit=5&offset=10")
        self.assertEqual(response.status_code, 200)
        fake.list_page.assert_awaited_once_with(
            self.user.tenant_id, status="dismissed", limit=5, offset=10
        )

if __name__ == "__main__":
    unittest.main()
