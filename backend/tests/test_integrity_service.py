"""Extension detection: per-organization blocklist and policy, per-job switch, scan evidence."""

import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException
from pydantic import ValidationError as PydanticValidationError

from app.exceptions import ConflictError, NotFoundError
from app.models.models import ExtensionBlocklistEntry, ExtensionOrgPolicy, Job, User
from app.schemas.integrity import (
    OrgPolicyUpdate,
    BlocklistEntryCreate,
    BlocklistEntryUpdate,
    FlaggedExtensionIn,
    IntegrityScanIn,
    PolicyRules,
    AddObservedToBlocklist,
    MAX_BLOCKLIST_ENTRIES,
    Thresholds,
)
from app.services.integrity_defaults import DEFAULT_RULES, SEED_BLOCKLIST
from app.services.integrity_service import (
    POLICY_UNAVAILABLE,
    IntegrityService,
    build_summary,
    compute_outcome,
)

NOW = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)
VALID_ID = "abcdefghijklmnopabcdefghijklmnop"


def _flagged(**over):
    base = dict(id="a" * 32, name="Some AI", reason_code="heuristic_weak")
    base.update(over)
    return FlaggedExtensionIn(**base)


# ── pure functions ───────────────────────────────────────────────────────────


class OutcomeTests(unittest.TestCase):
    def test_incomplete_scan_is_unavailable_never_clear(self):
        self.assertEqual(compute_outcome(False, []), "unavailable")
        self.assertEqual(compute_outcome(False, [_flagged(blocked=True)]), "unavailable")

    def test_clear_flagged_blocked(self):
        self.assertEqual(compute_outcome(True, []), "clear")
        self.assertEqual(compute_outcome(True, [_flagged()]), "flagged")
        self.assertEqual(compute_outcome(True, [_flagged(), _flagged(blocked=True)]), "blocked")

    def test_would_block_in_shadow_mode_is_flagged_not_blocked(self):
        self.assertEqual(
            compute_outcome(True, [_flagged(reason_code="heuristic_strong", would_block=True)]),
            "flagged",
        )


def _scan(phase, outcome, flagged, minutes, mode="shadow", error_code=None):
    return SimpleNamespace(
        phase=phase,
        outcome=outcome,
        flagged=flagged,
        flagged_count=len(flagged),
        mode=mode,
        error_code=error_code,
        created_at=NOW + timedelta(minutes=minutes),
    )


class SummaryTests(unittest.TestCase):
    def test_no_scans_means_no_section(self):
        self.assertIsNone(build_summary([]))

    def test_extensions_are_deduplicated_across_scans(self):
        item = {"id": "x" * 32, "name": "Helper AI", "reason_code": "heuristic_weak"}
        summary = build_summary(
            [
                _scan("preflight", "flagged", [item], 0),
                _scan("final", "flagged", [item], 5),
                _scan("start", "flagged", [item], 6),
            ]
        )
        self.assertEqual(summary.scans, 3)
        self.assertEqual(len(summary.flagged_extensions), 1)
        self.assertEqual(summary.flagged_extensions[0].seen_in_scans, 3)
        self.assertEqual(summary.flagged_extensions[0].first_seen_phase, "preflight")

    def test_blocked_and_latest_outcome(self):
        blocked = {"id": "b" * 32, "name": "Monica", "reason_code": "known_id", "blocked": True}
        summary = build_summary(
            [_scan("preflight", "blocked", [blocked], 0), _scan("preflight", "clear", [], 3)]
        )
        self.assertTrue(summary.was_ever_blocked)
        self.assertEqual(summary.latest_outcome, "clear")
        # The candidate fixed it, but HR can still see it was there.
        self.assertEqual(summary.flagged_extensions[0].name, "Monica")

    def test_blocked_sorts_before_weak(self):
        weak = {"id": "w" * 32, "name": "Zed", "reason_code": "heuristic_weak"}
        blocked = {"id": "b" * 32, "name": "Alpha", "reason_code": "known_id", "blocked": True}
        summary = build_summary([_scan("final", "blocked", [weak, blocked], 0)])
        self.assertEqual([e.name for e in summary.flagged_extensions], ["Alpha", "Zed"])

    def test_note_is_neutral_and_lists_names(self):
        flagged = [{"id": str(i) * 32, "name": f"Ext {i}", "reason_code": "heuristic_weak"} for i in range(7)]
        note = build_summary([_scan("final", "flagged", flagged, 0)]).note
        self.assertIn("flagged for review", note)
        self.assertIn("and 2 more", note)
        self.assertNotIn("cheat", note.lower())

    def test_clean_scans_have_no_note(self):
        summary = build_summary([_scan("preflight", "clear", [], 0)])
        self.assertIsNone(summary.note)
        self.assertEqual(summary.flagged_extensions, [])


# ── schemas ──────────────────────────────────────────────────────────────────


class SchemaTests(unittest.TestCase):
    def test_defaults_and_seed_are_valid(self):
        PolicyRules.model_validate(DEFAULT_RULES)
        for item in SEED_BLOCKLIST:
            BlocklistEntryCreate(**item)
        ids = [i["extension_id"] for i in SEED_BLOCKLIST]
        self.assertEqual(len(ids), len(set(ids)))

    def test_extension_test_rules_match_the_backend_defaults(self):
        """The extension's evaluation corpus is run against a copy of the rules.

        If the defaults change without refreshing the fixture, the corpus tests
        would be measuring rules nobody ships.
        """
        import json
        from pathlib import Path

        fixture = (
            Path(__file__).resolve().parents[2]
            / "chrome-extension" / "tests" / "fixtures" / "default-rules.json"
        )
        self.assertEqual(json.loads(fixture.read_text()), DEFAULT_RULES)

    def test_extension_id_must_be_a_real_chrome_id(self):
        for bad in ("short", "1" * 32, "abc" * 11, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "a" * 31, "a" * 33):
            with self.assertRaises(PydanticValidationError):
                BlocklistEntryCreate(extension_id=bad, name="x", reason="y")
        entry = BlocklistEntryCreate(extension_id=f" {VALID_ID.upper()} ", name="x", reason="y")
        self.assertEqual(entry.extension_id, VALID_ID)

    def test_weak_threshold_cannot_exceed_strong(self):
        with self.assertRaises(PydanticValidationError):
            Thresholds(intent_strong=3, capability_strong=3, intent_weak=5)

    def test_rules_are_bounded(self):
        rules = dict(DEFAULT_RULES)
        too_many = {"intent": {**DEFAULT_RULES["intent"], "keywords": [{"term": f"t{i}", "weight": 1} for i in range(201)]}}
        with self.assertRaises(PydanticValidationError):
            PolicyRules.model_validate({**rules, **too_many})
        with self.assertRaises(PydanticValidationError):
            PolicyRules.model_validate({**rules, "capability": {"permissions": {"tabCapture": 99}}})

    def test_scores_are_clamped_not_rejected(self):
        # Rules are admin-editable, so a legitimate score can exceed any fixed cap;
        # rejecting would silently drop the evidence for the strongest matches.
        item = FlaggedExtensionIn(
            id="a" * 32, name="x", reason_code="heuristic_strong",
            intent_score=2_000_000, capability_score=-5,
        )
        self.assertEqual((item.intent_score, item.capability_score), (10_000, 0))
        junk = FlaggedExtensionIn(
            id="a" * 32, name="x", reason_code="heuristic_weak", intent_score="not a number"
        )
        self.assertEqual(junk.intent_score, 0)

    def test_scan_payload_is_bounded_and_typed(self):
        with self.assertRaises(PydanticValidationError):
            IntegrityScanIn(phase="elsewhere", scan_completed=True)
        with self.assertRaises(PydanticValidationError):
            IntegrityScanIn(phase="final", scan_completed=True, flagged=[_flagged() for _ in range(26)])
        ok = IntegrityScanIn(
            phase="final", scan_completed=True, flagged=[_flagged(signals=["a" * 200, "  ", "b"])]
        )
        self.assertEqual(ok.flagged[0].signals, ["a" * 80, "b"])


# ── service ──────────────────────────────────────────────────────────────────


class FakeRepo:
    """In-memory stand-in that keeps the real repository's tenant scoping."""

    def __init__(self):
        self.policies: dict[uuid.UUID, ExtensionOrgPolicy] = {}
        self.entries: list[ExtensionBlocklistEntry] = []
        self.scans: list = []

    async def get_org_policy(self, tenant_id, *, for_update=False):
        return self.policies.get(tenant_id)

    async def ensure_org_policy_row(self, tenant_id):
        self.policies.setdefault(
            tenant_id,
            ExtensionOrgPolicy(
                tenant_id=tenant_id, extension_enabled=True, version=1, blocklist_seeded_at=None,
                updated_at=NOW,
            ),
        )

    async def list_blocklist(self, tenant_id, *, active_only=False):
        return [
            e for e in self.entries
            if e.tenant_id == tenant_id and (not active_only or e.status == "active")
        ]

    async def count_blocklist(self, tenant_id):
        mine = [e for e in self.entries if e.tenant_id == tenant_id]
        return sum(1 for e in mine if e.status == "active"), len(mine)

    async def get_entry(self, tenant_id, entry_id):
        return next((e for e in self.entries if e.tenant_id == tenant_id and e.id == entry_id), None)

    async def get_entry_by_extension_id(self, tenant_id, extension_id):
        return next(
            (e for e in self.entries if e.tenant_id == tenant_id and e.extension_id == extension_id),
            None,
        )

    def add_entry(self, entry):
        if entry.id is None:
            entry.id = uuid.uuid4()
        if entry.status is None:
            entry.status = "active"
        self.entries.append(entry)
        return entry

    async def delete_entry(self, entry):
        self.entries.remove(entry)

    def add_scan(self, scan):
        self.scans.append(scan)
        return scan

    async def list_scans(self, interview_session_id, *, limit=100):
        return [s for s in self.scans if s.interview_session_id == interview_session_id]

    async def flush(self):
        pass


class _Savepoint:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def _entry(tenant_id, extension_id=VALID_ID, status="active", name="Monica"):
    return ExtensionBlocklistEntry(
        id=uuid.uuid4(), tenant_id=tenant_id, extension_id=extension_id, name=name,
        category="ai_assistant", reason="AI", listing_url=None, status=status, origin="custom",
        created_at=NOW, updated_at=NOW,
    )


def _service(*, enabled=True, mode="shadow", session_status="pending", tenant_id=None):
    """A service wired to a fake repo, one job and one interview."""
    tenant_id = tenant_id or uuid.uuid4()
    session = AsyncMock()
    job = Job(
        id=uuid.uuid4(), tenant_id=tenant_id, extension_check_enabled=enabled,
        extension_check_mode=mode,
    )
    interview = SimpleNamespace(
        id=uuid.uuid4(), status=session_status, unique_token="tok", job_id=job.id,
        extension_check_enabled=None, extension_check_mode=None, extension_policy_version=None,
        extension_check_disabled_by=None,
    )
    session.get = AsyncMock(return_value=job)
    session.begin_nested = MagicMock(return_value=_Savepoint())
    repo = FakeRepo()
    interviews = MagicMock()
    interviews.get_session_by_token = AsyncMock(
        return_value=None if session_status is None else interview
    )
    audit = AsyncMock()
    observed = MagicMock()
    observed.record = AsyncMock()
    observed.require = AsyncMock()
    service = IntegrityService(
        session, repo=repo, interviews=interviews, audit=audit, observed=observed
    )
    return SimpleNamespace(
        service=service, session=session, repo=repo, audit=audit, observed=observed,
        job=job, interview=interview, tenant_id=tenant_id,
    )


def _admin(tenant_id):
    return User(
        id=uuid.uuid4(), tenant_id=tenant_id, email="admin@org.example.com",
        full_name="Admin", hashed_password="x", role="admin", is_active=True,
    )


class SeedingTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_use_copies_the_defaults_into_the_organization(self):
        t = _service()
        policy = await t.service.ensure_defaults(t.tenant_id)
        entries = await t.repo.list_blocklist(t.tenant_id)
        self.assertEqual(len(entries), len(SEED_BLOCKLIST))
        self.assertTrue(all(e.origin == "default" for e in entries))
        self.assertIsNotNone(policy.blocklist_seeded_at)

    async def test_an_emptied_list_is_not_seeded_again(self):
        t = _service()
        await t.service.ensure_defaults(t.tenant_id)
        t.repo.entries.clear()
        await t.service.ensure_defaults(t.tenant_id)
        self.assertEqual(t.repo.entries, [])

    async def test_each_organization_gets_its_own_copy(self):
        a, b = _service(), _service()
        b.repo = a.repo
        b.service._repo = a.repo
        await a.service.ensure_defaults(a.tenant_id)
        await b.service.ensure_defaults(b.tenant_id)
        self.assertEqual(len(a.repo.entries), 2 * len(SEED_BLOCKLIST))
        self.assertEqual(len(await a.repo.list_blocklist(a.tenant_id)), len(SEED_BLOCKLIST))
        self.assertNotEqual({e.id for e in a.repo.entries if e.tenant_id == a.tenant_id},
                            {e.id for e in a.repo.entries if e.tenant_id == b.tenant_id})

    async def test_a_new_organization_is_seeded_inside_its_own_transaction(self):
        t = _service()
        await t.service.seed_new_organization(t.tenant_id)
        self.assertEqual(len(t.repo.entries), len(SEED_BLOCKLIST))
        t.session.commit.assert_not_awaited()


class PolicyForJobTests(unittest.IsolatedAsyncioTestCase):
    async def _seeded(self, **kw):
        t = _service(**kw)
        await t.service.ensure_defaults(t.tenant_id)
        t.repo.entries.clear()
        t.repo.entries.append(_entry(t.tenant_id))
        t.repo.entries.append(_entry(t.tenant_id, "b" * 32, status="inactive", name="Off"))
        return t

    async def test_on_lists_only_active_entries_with_the_jobs_mode_and_org_version(self):
        t = await self._seeded(mode="enforce")
        t.repo.policies[t.tenant_id].version = 7
        result = await t.service.policy_for_interview("tok")
        self.assertTrue(result.enabled)
        self.assertEqual((result.version, result.mode), (7, "enforce"))
        self.assertEqual([b.id for b in result.blocklist], [VALID_ID])
        self.assertGreater(len(result.rules.intent.keywords), 0)

    async def test_two_jobs_of_one_org_share_the_list_but_not_the_mode(self):
        shadow = await self._seeded(mode="shadow")
        enforce = _service(mode="enforce", tenant_id=shadow.tenant_id)
        enforce.repo = shadow.repo
        enforce.service._repo = shadow.repo
        a = await shadow.service.policy_for_interview("tok")
        b = await enforce.service.policy_for_interview("tok")
        self.assertEqual([x.id for x in a.blocklist], [x.id for x in b.blocklist])
        self.assertEqual((a.mode, b.mode), ("shadow", "enforce"))

    async def test_off_sends_nothing_to_check(self):
        t = await self._seeded(enabled=False)
        result = await t.service.policy_for_interview("tok")
        self.assertFalse(result.enabled)
        self.assertEqual(result.blocklist, [])

    async def test_the_orgs_master_switch_outranks_the_jobs_own(self):
        t = await self._seeded(enabled=True)
        t.repo.policies[t.tenant_id].extension_enabled = False
        result = await t.service.policy_for_interview("tok")
        self.assertFalse(result.enabled)
        self.assertEqual(result.blocklist, [])
        self.assertEqual(
            (t.interview.extension_check_enabled, t.interview.extension_check_disabled_by),
            (False, "org"),
        )

    async def test_a_job_that_is_off_is_recorded_as_off_by_the_job(self):
        t = await self._seeded(enabled=False)
        await t.service.policy_for_interview("tok")
        self.assertEqual(t.interview.extension_check_disabled_by, "job")

    async def test_a_running_check_has_no_reason_it_was_off(self):
        t = await self._seeded(enabled=True)
        await t.service.policy_for_interview("tok")
        self.assertIsNone(t.interview.extension_check_disabled_by)

    async def test_look_alike_terms_are_always_sent_while_the_check_is_on(self):
        t = await self._seeded()
        result = await t.service.policy_for_interview("tok")
        self.assertTrue(result.rules.intent.keywords)
        self.assertTrue(result.rules.intent.vendor_hosts)

    async def test_an_off_job_gets_rules_that_flag_nothing(self):
        t = await self._seeded(enabled=False)
        result = await t.service.policy_for_interview("tok")
        self.assertEqual((result.rules.intent.keywords, result.rules.intent.vendor_hosts), ([], []))

    async def test_the_policy_fetch_stamps_the_interview(self):
        t = await self._seeded(mode="enforce")
        await t.service.policy_for_interview("tok")
        self.assertEqual(
            (t.interview.extension_check_enabled, t.interview.extension_check_mode), (True, "enforce")
        )
        self.assertIsNotNone(t.interview.extension_policy_version)

    async def test_start_stamps_the_job_settings(self):
        t = _service(enabled=False, mode="enforce")
        await t.service.stamp_interview(t.interview, t.job)
        self.assertEqual(
            (t.interview.extension_check_enabled, t.interview.extension_check_mode), (False, "enforce")
        )

    async def test_unknown_expired_and_finished_interviews_are_refused(self):
        t = _service(session_status=None)
        with self.assertRaises(NotFoundError):
            await t.service.policy_for_interview("nope")
        for status, code in (("expired", 410), ("cancelled", 410), ("completed", 409)):
            t = _service(session_status=status)
            with self.assertRaises(HTTPException) as ctx:
                await t.service.record_scan("tok", IntegrityScanIn(phase="final", scan_completed=True))
            self.assertEqual(ctx.exception.status_code, code, status)

    async def test_a_missing_job_is_not_found_not_a_crash(self):
        t = _service()
        t.session.get = AsyncMock(return_value=None)
        with self.assertRaises(NotFoundError):
            await t.service.policy_for_interview("tok")


class RecordScanTests(unittest.IsolatedAsyncioTestCase):
    async def test_outcome_is_computed_server_side(self):
        t = _service()
        body = IntegrityScanIn(
            phase="preflight", scan_completed=True, policy_version=3, mode="shadow",
            flagged=[_flagged(blocked=True, reason_code="known_id")],
        )
        ack = await t.service.record_scan("tok", body)
        stored = t.repo.scans[0]
        self.assertEqual((ack.outcome, stored.outcome), ("blocked", "blocked"))
        self.assertEqual((stored.flagged_count, stored.phase, stored.policy_version), (1, "preflight", 3))
        t.session.commit.assert_awaited()

    async def test_flagged_extensions_reach_this_orgs_catalog_only(self):
        t = _service()
        body = IntegrityScanIn(phase="final", scan_completed=True, flagged=[_flagged()])
        await t.service.record_scan("tok", body)
        args = t.observed.record.await_args.args
        self.assertEqual(args[0], t.tenant_id)

    async def test_a_scan_without_a_version_records_the_orgs_current_one(self):
        t = _service(mode="enforce")
        await t.service.ensure_defaults(t.tenant_id)
        t.repo.policies[t.tenant_id].version = 9
        await t.service.record_scan("tok", IntegrityScanIn(phase="final", scan_completed=True))
        self.assertEqual((t.repo.scans[0].policy_version, t.repo.scans[0].mode), (9, "enforce"))

    async def test_failed_scan_is_recorded_as_unavailable(self):
        t = _service()
        ack = await t.service.record_scan(
            "tok", IntegrityScanIn(phase="final", scan_completed=False, error_code="scan_failed")
        )
        self.assertEqual(ack.outcome, "unavailable")
        self.assertEqual(t.repo.scans[0].error_code, "scan_failed")

    async def test_policy_unavailable_is_could_not_be_checked_never_clear(self):
        t = _service()
        ack = await t.service.record_scan(
            "tok",
            IntegrityScanIn(phase="preflight", scan_completed=False, error_code=POLICY_UNAVAILABLE),
        )
        self.assertEqual(ack.outcome, "unavailable")
        summary = build_summary([SimpleNamespace(
            phase=s.phase, outcome=s.outcome, flagged=s.flagged, flagged_count=s.flagged_count,
            mode=s.mode, error_code=s.error_code, created_at=NOW) for s in t.repo.scans])
        self.assertEqual(summary.latest_error_code, POLICY_UNAVAILABLE)
        self.assertEqual(summary.unavailable_scans, 1)

    async def test_a_disabled_job_stores_nothing(self):
        t = _service(enabled=False)
        body = IntegrityScanIn(
            phase="final", scan_completed=True, flagged=[_flagged(blocked=True)]
        )
        ack = await t.service.record_scan("tok", body)
        self.assertFalse(ack.recorded)
        self.assertEqual(t.repo.scans, [])
        t.observed.record.assert_not_awaited()


    async def test_scans_are_ignored_while_the_orgs_switch_is_off(self):
        t = _service(enabled=True)
        await t.service.ensure_defaults(t.tenant_id)
        t.repo.policies[t.tenant_id].extension_enabled = False
        body = IntegrityScanIn(
            phase="final", scan_completed=True, flagged=[_flagged(blocked=True)]
        )
        ack = await t.service.record_scan("tok", body)
        self.assertFalse(ack.recorded)
        self.assertEqual(t.repo.scans, [])
        t.observed.record.assert_not_awaited()


class OrgPolicyTests(unittest.IsolatedAsyncioTestCase):
    async def _ready(self):
        t = _service()
        await t.service.ensure_defaults(t.tenant_id)
        return t, _admin(t.tenant_id)

    async def test_turning_the_org_switch_off_bumps_the_version_and_is_audited(self):
        t, admin = await self._ready()
        before = t.repo.policies[t.tenant_id].version
        result = await t.service.update_org_policy(OrgPolicyUpdate(enabled=False), admin)
        policy = t.repo.policies[t.tenant_id]
        self.assertEqual((policy.extension_enabled, policy.version), (False, before + 1))
        self.assertFalse(result.enabled)
        kwargs = t.audit.log_field_changes.await_args.kwargs
        self.assertEqual(kwargs["action"], "settings.extension_policy_updated")
        self.assertEqual(kwargs["changes"], {"extension_enabled": (True, False)})

    async def test_an_unchanged_org_switch_does_not_bump_the_version(self):
        t, admin = await self._ready()
        before = t.repo.policies[t.tenant_id].version
        await t.service.update_org_policy(OrgPolicyUpdate(enabled=True), admin)
        await t.service.update_org_policy(OrgPolicyUpdate(), admin)
        self.assertEqual(t.repo.policies[t.tenant_id].version, before)
        t.audit.log_field_changes.assert_not_awaited()

    async def test_the_org_switch_starts_on(self):
        t, admin = await self._ready()
        self.assertTrue((await t.service.get_org_policy(admin, can_edit=True)).enabled)
        self.assertTrue(await t.service.org_enabled(t.tenant_id))

    async def test_the_summary_counts_defaults_and_carries_can_edit(self):
        t, admin = await self._ready()
        result = await t.service.get_org_policy(admin, can_edit=False)
        self.assertFalse(result.can_edit)
        self.assertEqual((result.entry_count, result.defaults_present), (len(SEED_BLOCKLIST),) * 2)
        self.assertEqual(result.entry_cap, MAX_BLOCKLIST_ENTRIES)


class BlocklistAdminTests(unittest.IsolatedAsyncioTestCase):
    async def _ready(self):
        t = _service()
        await t.service.ensure_defaults(t.tenant_id)
        return t, _admin(t.tenant_id)

    async def test_add_creates_a_custom_entry_bumps_version_and_audits(self):
        t, admin = await self._ready()
        before = t.repo.policies[t.tenant_id].version
        entry = await t.service.add_entry(
            BlocklistEntryCreate(extension_id=VALID_ID, name="New AI", reason="AI assistant"), admin
        )
        self.assertEqual(entry.origin, "custom")
        self.assertEqual(entry.tenant_id, t.tenant_id)
        self.assertEqual(t.repo.policies[t.tenant_id].version, before + 1)
        self.assertEqual(t.audit.log_change.await_args.kwargs["action"], "settings.extension_blocklist_added")

    async def test_duplicate_id_in_the_same_org_is_a_conflict(self):
        t, admin = await self._ready()
        await t.service.add_entry(BlocklistEntryCreate(extension_id=VALID_ID, name="x", reason="y"), admin)
        with self.assertRaises(ConflictError):
            await t.service.add_entry(BlocklistEntryCreate(extension_id=VALID_ID, name="x", reason="y"), admin)

    async def test_the_same_id_can_exist_in_two_orgs(self):
        a, admin_a = await self._ready()
        b = _service()
        b.repo, b.service._repo = a.repo, a.repo
        await b.service.ensure_defaults(b.tenant_id)
        await a.service.add_entry(BlocklistEntryCreate(extension_id=VALID_ID, name="x", reason="y"), admin_a)
        await b.service.add_entry(
            BlocklistEntryCreate(extension_id=VALID_ID, name="x", reason="y"), _admin(b.tenant_id)
        )
        self.assertEqual(sum(1 for e in a.repo.entries if e.extension_id == VALID_ID), 2)

    async def test_the_list_has_a_cap(self):
        t, admin = await self._ready()
        t.repo.entries.extend(
            _entry(t.tenant_id, f"{chr(97 + i % 16)}{i:031d}".translate(str.maketrans("0123456789", "abcdefghij")))
            for i in range(MAX_BLOCKLIST_ENTRIES - len(t.repo.entries))
        )
        self.assertEqual(len(t.repo.entries), MAX_BLOCKLIST_ENTRIES)
        with self.assertRaises(ConflictError):
            await t.service.add_entry(
                BlocklistEntryCreate(extension_id=VALID_ID, name="x", reason="y"), admin
            )

    async def test_deactivating_changes_status_and_audits_old_and_new(self):
        t, admin = await self._ready()
        entry = t.repo.entries[0]
        await t.service.update_entry(entry.id, BlocklistEntryUpdate(status="inactive"), admin)
        self.assertEqual(entry.status, "inactive")
        kwargs = t.audit.log_change.await_args.kwargs
        self.assertEqual((kwargs["before"]["status"], kwargs["after"]["status"]), ("active", "inactive"))

    async def test_the_extension_id_cannot_be_edited(self):
        with self.assertRaises(PydanticValidationError):
            BlocklistEntryUpdate(extension_id=VALID_ID)

    async def test_another_orgs_entry_is_not_found(self):
        t, admin = await self._ready()
        other = _entry(uuid.uuid4())
        t.repo.entries.append(other)
        with self.assertRaises(NotFoundError):
            await t.service.update_entry(other.id, BlocklistEntryUpdate(status="inactive"), admin)
        with self.assertRaises(NotFoundError):
            await t.service.delete_entry(other.id, admin)
        self.assertIn(other, t.repo.entries)

    async def test_delete_removes_and_audits(self):
        t, admin = await self._ready()
        entry = t.repo.entries[0]
        await t.service.delete_entry(entry.id, admin)
        self.assertNotIn(entry, t.repo.entries)
        self.assertEqual(t.audit.log_change.await_args.kwargs["action"], "settings.extension_blocklist_deleted")

    async def test_restore_adds_back_missing_and_reenables_but_keeps_custom_and_edits(self):
        t, admin = await self._ready()
        custom = await t.service.add_entry(
            BlocklistEntryCreate(extension_id=VALID_ID, name="Mine", reason="mine"), admin
        )
        deleted, switched_off, edited = t.repo.entries[0], t.repo.entries[1], t.repo.entries[2]
        t.repo.entries.remove(deleted)
        switched_off.status = "inactive"
        edited.reason = "Our own wording"
        result = await t.service.restore_defaults(admin)
        self.assertEqual((result.added, result.reset), (1, 1))
        self.assertEqual(result.unchanged, len(SEED_BLOCKLIST) - 2)
        self.assertEqual(switched_off.status, "active")
        self.assertEqual(edited.reason, "Our own wording")
        self.assertIn(custom, t.repo.entries)
        again = await t.service.restore_defaults(admin)
        self.assertEqual((again.added, again.reset), (0, 0))

    async def test_add_from_seen_uses_the_seen_name_and_the_orgs_list(self):
        t, admin = await self._ready()
        t.observed.require.return_value = SimpleNamespace(
            extension_id=VALID_ID, name="Seen AI", strongest_reason="heuristic_strong"
        )
        entry = await t.service.add_observed_to_blocklist(
            uuid.uuid4(), AddObservedToBlocklist(category="ai_assistant", reason=None), admin
        )
        self.assertEqual((entry.name, entry.tenant_id), ("Seen AI", t.tenant_id))
        t.observed.require.assert_awaited_with(t.tenant_id, unittest.mock.ANY)


if __name__ == "__main__":
    unittest.main()
