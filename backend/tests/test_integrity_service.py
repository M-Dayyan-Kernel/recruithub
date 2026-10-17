"""Extension detection: policy, blocklist administration, scan evidence."""

import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException
from pydantic import ValidationError as PydanticValidationError

from app.exceptions import ConflictError, NotFoundError
from app.models.models import ExtensionBlocklistEntry, ExtensionPolicy, User
from app.schemas.integrity import (
    BlocklistEntryCreate,
    BlocklistEntryUpdate,
    FlaggedExtensionIn,
    IntegrityScanIn,
    PolicyRules,
    PolicyUpdateRequest,
    Thresholds,
)
from app.services.integrity_defaults import DEFAULT_RULES, SEED_BLOCKLIST
from app.services.integrity_service import IntegrityService, build_summary, compute_outcome

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


def _scan(phase, outcome, flagged, minutes, mode="shadow"):
    return SimpleNamespace(
        phase=phase,
        outcome=outcome,
        flagged=flagged,
        flagged_count=len(flagged),
        mode=mode,
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


def _service(*, session_status="pending", policy=None, entries=None):
    session = AsyncMock()
    repo = MagicMock()
    repo.get_policy = AsyncMock(return_value=policy)
    repo.add_policy = MagicMock()
    repo.add_entry = MagicMock(side_effect=lambda e: e)
    repo.flush = AsyncMock()
    repo.count_blocklist = AsyncMock(return_value=(len(entries or []), len(entries or [])))
    repo.list_blocklist = AsyncMock(return_value=entries or [])
    repo.get_entry_by_extension_id = AsyncMock(return_value=None)
    repo.get_entry = AsyncMock(return_value=None)
    repo.delete_entry = AsyncMock()
    repo.add_scan = MagicMock(side_effect=lambda s: s)
    repo.list_scans = AsyncMock(return_value=[])

    interviews = MagicMock()
    interview = SimpleNamespace(id=uuid.uuid4(), status=session_status, unique_token="tok")
    interviews.get_session_by_token = AsyncMock(
        return_value=None if session_status is None else interview
    )
    audit = AsyncMock()
    return IntegrityService(session, repo=repo, interviews=interviews, audit=audit), session, repo, audit


def _policy(version=3, mode="shadow"):
    return ExtensionPolicy(
        id=1, version=version, mode=mode, rules=dict(DEFAULT_RULES), updated_at=NOW
    )


def _admin():
    return User(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="root@p.example.com",
        full_name="Root", hashed_password="x", role="superadmin", is_active=True,
    )


class DefaultsTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_use_seeds_policy_and_blocklist(self):
        service, session, repo, _ = _service(policy=None, entries=[])
        repo.count_blocklist = AsyncMock(return_value=(0, 0))
        policy = await service.ensure_defaults()
        self.assertEqual(policy.mode, "shadow")
        self.assertEqual(policy.version, 1)
        self.assertEqual(repo.add_entry.call_count, len(SEED_BLOCKLIST))
        session.commit.assert_awaited_once()

    async def test_existing_policy_is_left_alone(self):
        service, session, repo, _ = _service(policy=_policy())
        await service.ensure_defaults()
        repo.add_entry.assert_not_called()
        session.commit.assert_not_awaited()

    async def test_does_not_reseed_a_populated_blocklist(self):
        service, _, repo, _ = _service(policy=None, entries=[])
        repo.count_blocklist = AsyncMock(return_value=(2, 2))
        await service.ensure_defaults()
        repo.add_entry.assert_not_called()


class PublicFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_policy_lists_only_active_entries_with_rules_and_version(self):
        entry = ExtensionBlocklistEntry(
            id=uuid.uuid4(), extension_id=VALID_ID, name="Monica", category="ai_assistant",
            reason="AI", listing_url=None, status="active", created_at=NOW, updated_at=NOW,
        )
        service, _, repo, _ = _service(policy=_policy(version=7, mode="enforce"), entries=[entry])
        result = await service.policy_for_interview("tok")
        repo.list_blocklist.assert_awaited_with(active_only=True)
        self.assertEqual((result.version, result.mode), (7, "enforce"))
        self.assertEqual(result.blocklist[0].id, VALID_ID)
        self.assertEqual(result.rules.thresholds.intent_strong, 4)

    async def test_unknown_expired_and_finished_interviews_are_refused(self):
        service, _, _, _ = _service(session_status=None, policy=_policy())
        with self.assertRaises(NotFoundError):
            await service.policy_for_interview("nope")

        service, _, _, _ = _service(session_status="expired", policy=_policy())
        with self.assertRaises(HTTPException) as ctx:
            await service.record_scan("tok", IntegrityScanIn(phase="final", scan_completed=True))
        self.assertEqual(ctx.exception.status_code, 410)

        service, _, _, _ = _service(session_status="completed", policy=_policy())
        with self.assertRaises(HTTPException) as ctx:
            await service.record_scan("tok", IntegrityScanIn(phase="final", scan_completed=True))
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_outcome_is_computed_server_side(self):
        service, session, repo, _ = _service(policy=_policy())
        body = IntegrityScanIn(
            phase="preflight", scan_completed=True, policy_version=3, mode="shadow",
            flagged=[_flagged(blocked=True, reason_code="known_id")],
        )
        ack = await service.record_scan("tok", body)
        stored = repo.add_scan.call_args.args[0]
        self.assertEqual(ack.outcome, "blocked")
        self.assertEqual(stored.outcome, "blocked")
        self.assertEqual(stored.flagged_count, 1)
        self.assertEqual(stored.phase, "preflight")
        session.commit.assert_awaited_once()

    async def test_failed_scan_is_recorded_as_unavailable(self):
        service, _, repo, _ = _service(policy=_policy())
        ack = await service.record_scan(
            "tok", IntegrityScanIn(phase="final", scan_completed=False, error_code="scan_failed")
        )
        self.assertEqual(ack.outcome, "unavailable")
        self.assertEqual(repo.add_scan.call_args.args[0].error_code, "scan_failed")


class AdminTests(unittest.IsolatedAsyncioTestCase):
    async def test_every_list_edit_bumps_the_policy_version(self):
        policy = _policy(version=3)
        service, _, repo, audit = _service(policy=policy)
        entry = await service.add_entry(
            BlocklistEntryCreate(extension_id=VALID_ID, name="New AI", reason="AI assistant"), _admin()
        )
        self.assertEqual(policy.version, 4)
        audit.log_change.assert_awaited()
        self.assertEqual(entry.extension_id, VALID_ID)

    async def test_duplicate_extension_id_is_a_conflict(self):
        service, session, repo, _ = _service(policy=_policy())
        repo.get_entry_by_extension_id = AsyncMock(return_value=object())
        with self.assertRaises(ConflictError):
            await service.add_entry(
                BlocklistEntryCreate(extension_id=VALID_ID, name="x", reason="y"), _admin()
            )
        session.commit.assert_not_awaited()

    async def test_deactivating_removes_from_public_list_via_status(self):
        entry = ExtensionBlocklistEntry(
            id=uuid.uuid4(), extension_id=VALID_ID, name="Monica", category="ai_assistant",
            reason="AI", status="active", created_at=NOW, updated_at=NOW,
        )
        policy = _policy(version=3)
        service, _, repo, _ = _service(policy=policy)
        repo.get_entry = AsyncMock(return_value=entry)
        await service.update_entry(entry.id, BlocklistEntryUpdate(status="inactive"), _admin())
        self.assertEqual(entry.status, "inactive")
        self.assertEqual(policy.version, 4)

    async def test_unknown_entry_is_not_found(self):
        service, _, _, _ = _service(policy=_policy())
        with self.assertRaises(NotFoundError):
            await service.update_entry(uuid.uuid4(), BlocklistEntryUpdate(status="inactive"), _admin())
        with self.assertRaises(NotFoundError):
            await service.delete_entry(uuid.uuid4(), _admin())

    async def test_policy_change_bumps_version_but_a_no_op_does_not(self):
        policy = _policy(version=5, mode="shadow")
        service, session, _, _ = _service(policy=policy)
        session.refresh = AsyncMock()
        await service.update_policy(PolicyUpdateRequest(mode="shadow"), _admin())
        self.assertEqual(policy.version, 5)
        await service.update_policy(PolicyUpdateRequest(mode="enforce"), _admin())
        self.assertEqual((policy.version, policy.mode), (6, "enforce"))

    async def test_rules_edit_is_stored_and_versioned(self):
        policy = _policy(version=1)
        service, session, _, _ = _service(policy=policy)
        session.refresh = AsyncMock()
        rules = PolicyRules.model_validate(DEFAULT_RULES)
        rules.thresholds.intent_strong = 6
        await service.update_policy(PolicyUpdateRequest(rules=rules), _admin())
        self.assertEqual(policy.rules["thresholds"]["intent_strong"], 6)
        self.assertEqual(policy.version, 2)


if __name__ == "__main__":
    unittest.main()
