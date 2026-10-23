"""AI-assistant extension detection: policy, blocklist, scan evidence.

The browser extension does the classifying; this service owns the data it
needs (a versioned policy), records what it reports, and summarises it for HR.
It never receives a candidate's full extension inventory, only the extensions
that were flagged or blocked.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ConflictError, NotFoundError
from app.models.models import (
    ExtensionBlocklistEntry,
    ExtensionPolicy,
    InterviewIntegrityScan,
    InterviewSession,
    User,
)
from app.repositories.integrity_repository import IntegrityRepository
from app.repositories.interview_repository import InterviewRepository
from app.schemas.integrity import (
    BlocklistEntryCreate,
    BlocklistEntryUpdate,
    IntegrityFlaggedExtension,
    IntegrityPolicyResponse,
    IntegrityScanAck,
    IntegrityScanIn,
    IntegritySummary,
    IntegrityTimelineEntry,
    PolicyAdminResponse,
    PolicyRules,
    PolicyUpdateRequest,
    PublicBlocklistItem,
)
from app.services.audit_service import AuditService
from app.services.observed_extension_service import ObservedExtensionService
from app.services.integrity_defaults import (
    DEFAULT_MODE,
    DEFAULT_RULES,
    POLICY_ID,
    SEED_BLOCKLIST,
)

logger = logging.getLogger(__name__)

_POLICY_ENTITY_ID = uuid.UUID(int=POLICY_ID)
_TIMELINE_LIMIT = 30


# ── pure helpers (unit tested without a database) ───────────────────────────


def compute_outcome(scan_completed: bool, flagged: Iterable[Any]) -> str:
    """Server-side outcome for a reported scan. Never trusts a client label."""
    if not scan_completed:
        return "unavailable"
    items = list(flagged)
    if any(getattr(f, "blocked", False) for f in items):
        return "blocked"
    if items:
        return "flagged"
    return "clear"


def build_summary(scans: list[Any]) -> IntegritySummary | None:
    """Collapse an interview's scans into what the HR report shows.

    ``None`` when nothing was ever recorded (older interviews, or a candidate
    without the extension) so the report omits the section instead of
    implying a clean result.
    """
    if not scans:
        return None

    ordered = sorted(scans, key=lambda s: s.created_at)
    by_extension: dict[str, IntegrityFlaggedExtension] = {}
    for scan in ordered:
        for item in scan.flagged or []:
            ext_id = str(item.get("id", ""))
            if not ext_id:
                continue
            existing = by_extension.get(ext_id)
            if existing is None:
                by_extension[ext_id] = IntegrityFlaggedExtension(
                    id=ext_id,
                    name=str(item.get("name", ext_id)),
                    reason_code=str(item.get("reason_code", "heuristic_weak")),
                    blocked=bool(item.get("blocked", False)),
                    would_block=bool(item.get("would_block", False)),
                    intent_score=int(item.get("intent_score", 0)),
                    capability_score=int(item.get("capability_score", 0)),
                    signals=[str(s) for s in item.get("signals", [])][:12],
                    first_seen_phase=scan.phase,
                    seen_in_scans=1,
                )
            else:
                existing.seen_in_scans += 1
                existing.blocked = existing.blocked or bool(item.get("blocked", False))
                existing.would_block = existing.would_block or bool(item.get("would_block", False))

    latest = ordered[-1]
    flagged_sorted = sorted(
        by_extension.values(), key=lambda e: (not e.blocked, not e.would_block, e.name.lower())
    )
    timeline = [
        IntegrityTimelineEntry(
            phase=s.phase,
            outcome=s.outcome,
            flagged_count=s.flagged_count,
            mode=s.mode,
            at=s.created_at,
        )
        for s in ordered[-_TIMELINE_LIMIT:]
    ]
    return IntegritySummary(
        scans=len(ordered),
        latest_outcome=latest.outcome,
        was_ever_blocked=any(s.outcome == "blocked" for s in ordered),
        unavailable_scans=sum(1 for s in ordered if s.outcome == "unavailable"),
        flagged_extensions=flagged_sorted,
        timeline=timeline,
        note=_note_for(flagged_sorted),
    )


def _note_for(flagged: list[IntegrityFlaggedExtension]) -> str | None:
    """One neutral sentence: which extensions were flagged. No judgement."""
    if not flagged:
        return None
    names = ", ".join(e.name for e in flagged[:5])
    more = len(flagged) - 5
    suffix = f" and {more} more" if more > 0 else ""
    return f"Browser extensions flagged for review during this interview: {names}{suffix}."


# ── service ──────────────────────────────────────────────────────────────────


class IntegrityService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        repo: IntegrityRepository | None = None,
        interviews: InterviewRepository | None = None,
        audit: AuditService | None = None,
        observed: ObservedExtensionService | None = None,
    ) -> None:
        self._session = session
        self._repo = repo or IntegrityRepository(session)
        self._interviews = interviews or InterviewRepository(session)
        self._audit = audit or AuditService(session)
        self._observed = observed or ObservedExtensionService(session, audit=self._audit)

    # ── defaults ──────────────────────────────────────────────────────────

    async def ensure_defaults(self) -> ExtensionPolicy:
        """Create the policy row and seed the blocklist on first use. Idempotent."""
        policy = await self._repo.get_policy()
        if policy is not None:
            return policy

        policy = ExtensionPolicy(
            id=POLICY_ID, version=1, mode=DEFAULT_MODE, rules=dict(DEFAULT_RULES)
        )
        self._repo.add_policy(policy)
        try:
            await self._repo.flush()
            active, total = await self._repo.count_blocklist()
            if total == 0:
                for item in SEED_BLOCKLIST:
                    self._repo.add_entry(ExtensionBlocklistEntry(**item))
                await self._repo.flush()
            await self._session.commit()
        except IntegrityError:
            # Another request seeded first: use theirs.
            await self._session.rollback()
            existing = await self._repo.get_policy()
            if existing is None:
                raise
            return existing
        return policy

    # ── public (interview page) ───────────────────────────────────────────

    async def policy_for_interview(self, token: str) -> IntegrityPolicyResponse:
        await self._require_open_session(token)
        policy = await self.ensure_defaults()
        entries = await self._repo.list_blocklist(active_only=True)
        return IntegrityPolicyResponse(
            version=policy.version,
            mode=policy.mode,  # type: ignore[arg-type]
            blocklist=[
                PublicBlocklistItem(
                    id=e.extension_id,
                    name=e.name,
                    category=e.category,
                    reason=e.reason,
                    listing_url=e.listing_url,
                )
                for e in entries
            ],
            rules=PolicyRules.model_validate(policy.rules or DEFAULT_RULES),
        )

    async def record_scan(self, token: str, body: IntegrityScanIn) -> IntegrityScanAck:
        interview = await self._require_open_session(token)
        outcome = compute_outcome(body.scan_completed, body.flagged)
        # The description belongs to the extension, not to this interview: it is
        # kept once in the catalog, so the per-interview evidence stays small.
        flagged = [f.model_dump(exclude={"description"}) for f in body.flagged]
        client_time = body.checked_at
        if client_time is not None and client_time.tzinfo is None:
            client_time = client_time.replace(tzinfo=timezone.utc)

        self._repo.add_scan(
            InterviewIntegrityScan(
                interview_session_id=interview.id,
                phase=body.phase,
                outcome=outcome,
                flagged=flagged,
                flagged_count=len(flagged),
                policy_version=body.policy_version,
                mode=body.mode,
                error_code=body.error_code,
                client_checked_at=client_time,
            )
        )
        await self._record_observed(body)
        await self._session.commit()
        return IntegrityScanAck(outcome=outcome)  # type: ignore[arg-type]

    async def _record_observed(self, body: IntegrityScanIn) -> None:
        """Fold flagged extensions into the Super Admin catalog.

        Isolated in a savepoint: the catalog is a convenience, the scan is
        evidence. A catalog failure must never cost the interview its record.
        """
        if not body.flagged:
            return
        try:
            async with self._session.begin_nested():
                await self._observed.record(body.flagged)
        except Exception:  # noqa: BLE001 - deliberately broad, see docstring
            logger.exception("Could not update the observed-extensions catalog")

    async def summary_for_session(self, interview_session_id: uuid.UUID) -> IntegritySummary | None:
        return build_summary(await self._repo.list_scans(interview_session_id))

    async def _require_open_session(self, token: str) -> InterviewSession:
        interview = await self._interviews.get_session_by_token(token)
        if interview is None:
            raise NotFoundError(public_message="Interview session not found")
        if interview.status == "expired":
            raise HTTPException(status_code=410, detail="Interview link has expired.")
        if interview.status == "cancelled":
            raise HTTPException(status_code=410, detail="This interview has been cancelled.")
        if interview.status in ("completed", "assessed", "assessment_failed"):
            raise HTTPException(status_code=409, detail="Interview already completed.")
        return interview

    # ── Super Admin ───────────────────────────────────────────────────────

    async def admin_policy(self) -> PolicyAdminResponse:
        policy = await self.ensure_defaults()
        # Server-generated columns (updated_at) are not loaded on a row this
        # request just inserted, and async sessions cannot lazy-load them.
        await self._session.refresh(policy)
        active, total = await self._repo.count_blocklist()
        return self._admin_response(policy, active, total)

    async def update_policy(self, body: PolicyUpdateRequest, admin: User) -> PolicyAdminResponse:
        policy = await self.ensure_defaults()
        before = {"mode": policy.mode, "version": policy.version}
        changed = False
        if body.mode is not None and body.mode != policy.mode:
            policy.mode = body.mode
            changed = True
        if body.rules is not None:
            new_rules = body.rules.model_dump()
            if new_rules != policy.rules:
                policy.rules = new_rules
                changed = True
        if changed:
            policy.version += 1
            policy.updated_by_user_id = admin.id
            await self._audit.log_change(
                actor=admin,
                action="extension_policy.updated",
                entity_type="extension_policy",
                entity_id=_POLICY_ENTITY_ID,
                subject_label="Extension policy",
                feature="platform",
                before=before,
                after={"mode": policy.mode, "version": policy.version},
            )
        await self._session.commit()
        await self._session.refresh(policy)
        active, total = await self._repo.count_blocklist()
        return self._admin_response(policy, active, total)

    async def list_blocklist(self) -> list[ExtensionBlocklistEntry]:
        await self.ensure_defaults()
        return await self._repo.list_blocklist()

    async def add_entry(
        self, body: BlocklistEntryCreate, admin: User
    ) -> ExtensionBlocklistEntry:
        policy = await self.ensure_defaults()
        if await self._repo.get_entry_by_extension_id(body.extension_id):
            raise ConflictError(public_message="That extension is already on the list")
        entry = self._repo.add_entry(ExtensionBlocklistEntry(**body.model_dump()))
        try:
            await self._repo.flush()
        except IntegrityError as exc:  # concurrent add of the same ID
            await self._session.rollback()
            raise ConflictError(public_message="That extension is already on the list") from exc
        policy.version += 1
        await self._audit.log_change(
            actor=admin,
            action="extension_blocklist.added",
            entity_type="extension_blocklist",
            entity_id=entry.id,
            subject_label=entry.name,
            feature="platform",
            before=None,
            after={"extension_id": entry.extension_id, "status": entry.status},
        )
        await self._session.commit()
        await self._session.refresh(entry)
        return entry

    async def update_entry(
        self, entry_id: uuid.UUID, body: BlocklistEntryUpdate, admin: User
    ) -> ExtensionBlocklistEntry:
        policy = await self.ensure_defaults()
        entry = await self._repo.get_entry(entry_id)
        if entry is None:
            raise NotFoundError(public_message="Blocklist entry not found")
        before = {"name": entry.name, "status": entry.status, "category": entry.category}
        for field, value in body.model_dump(exclude_unset=True).items():
            if value is not None or field in ("listing_url", "verified_on"):
                setattr(entry, field, value)
        policy.version += 1
        await self._audit.log_change(
            actor=admin,
            action="extension_blocklist.updated",
            entity_type="extension_blocklist",
            entity_id=entry.id,
            subject_label=entry.name,
            feature="platform",
            before=before,
            after={"name": entry.name, "status": entry.status, "category": entry.category},
        )
        await self._session.commit()
        await self._session.refresh(entry)
        return entry

    async def delete_entry(self, entry_id: uuid.UUID, admin: User) -> None:
        policy = await self.ensure_defaults()
        entry = await self._repo.get_entry(entry_id)
        if entry is None:
            raise NotFoundError(public_message="Blocklist entry not found")
        label, ext_id = entry.name, entry.extension_id
        await self._repo.delete_entry(entry)
        policy.version += 1
        await self._audit.log_change(
            actor=admin,
            action="extension_blocklist.deleted",
            entity_type="extension_blocklist",
            entity_id=entry_id,
            subject_label=label,
            feature="platform",
            before={"extension_id": ext_id},
            after=None,
        )
        await self._session.commit()

    @staticmethod
    def _admin_response(policy: ExtensionPolicy, active: int, total: int) -> PolicyAdminResponse:
        return PolicyAdminResponse(
            version=policy.version,
            mode=policy.mode,  # type: ignore[arg-type]
            rules=PolicyRules.model_validate(policy.rules or DEFAULT_RULES),
            updated_at=policy.updated_at or datetime.now(timezone.utc),
            blocklist_active=active,
            blocklist_total=total,
        )
