"""AI-assistant extension detection: an organization's blocklist and policy, per-job settings, and
the scan evidence.

The browser extension does the classifying; this service owns the data it needs (a versioned
policy for the interview's job and organization), records what it reports, and summarises it
for HR. It never receives a candidate's full extension inventory, only the extensions that were
flagged or blocked.

Who controls what: an organization's Admins edit its blocklist; HR can view it.
Each job has its own on/off switch and mode (Admins and HR). The heuristic rules are the
platform's own, in code, and an organization can only switch them off.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import ConflictError, NotFoundError
from app.models.models import (
    ExtensionBlocklistEntry,
    ExtensionOrgPolicy,
    InterviewIntegrityScan,
    InterviewSession,
    Job,
    User,
)
from app.repositories.integrity_repository import IntegrityRepository
from app.repositories.interview_repository import InterviewRepository
from app.schemas.integrity import (
    MAX_BLOCKLIST_ENTRIES,
    AddObservedToBlocklist,
    BlocklistEntryCreate,
    BlocklistEntryUpdate,
    IntegrityFlaggedExtension,
    IntegrityPolicyResponse,
    IntegrityScanAck,
    IntegrityScanIn,
    IntegritySummary,
    IntegrityTimelineEntry,
    OrgPolicyResponse,
    PolicyRules,
    PublicBlocklistItem,
    RestoreDefaultsResult,
)
from app.services.audit_service import AuditService
from app.services.integrity_defaults import DEFAULT_MODE, SEED_BLOCKLIST, default_rules, neutral_rules
from app.services.observed_extension_service import ObservedExtensionService, listing_url

logger = logging.getLogger(__name__)

_TIMELINE_LIMIT = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


#: Recorded when the interview page could not fetch the policy and let the candidate in.
POLICY_UNAVAILABLE = "policy_unavailable"
_SEED_IDS = frozenset(item["extension_id"] for item in SEED_BLOCKLIST)
_DEFAULT_REASON = {
    "heuristic_strong": "Looks like an AI assistant that can read the page or capture audio.",
    "heuristic_weak": "May be an AI-related extension.",
}


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
        latest_error_code=latest.error_code,
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


@dataclass(frozen=True)
class InterviewPolicy:
    """What applies to one interview: its job's switch, its organization's list and version."""

    interview: InterviewSession
    job: Job
    org: ExtensionOrgPolicy

    @property
    def tenant_id(self) -> uuid.UUID:
        return self.job.tenant_id

    @property
    def enabled(self) -> bool:
        return bool(self.job.extension_check_enabled)

    @property
    def mode(self) -> str:
        return self.job.extension_check_mode or DEFAULT_MODE


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

    # ── organization defaults ─────────────────────────────────────────────

    async def ensure_defaults(self, tenant_id: uuid.UUID) -> ExtensionOrgPolicy:
        """The organization's policy row, created and seeded with the default blocklist on first
        use. Idempotent and safe under concurrent first requests.

        Seeded once: `blocklist_seeded_at` records it, so an organization that deletes every
        entry is not given the defaults back (that is "restore defaults", chosen by an Admin).
        """
        policy = await self._repo.get_org_policy(tenant_id)
        if policy is not None and policy.blocklist_seeded_at is not None:
            return policy

        await self._repo.ensure_org_policy_row(tenant_id)
        policy = await self._repo.get_org_policy(tenant_id, for_update=True)
        if policy is None:  # the organization itself is gone
            raise NotFoundError(public_message="Organization not found")
        if policy.blocklist_seeded_at is None:
            await self._seed_defaults(tenant_id)
            policy.blocklist_seeded_at = _now()
            await self._session.flush()
        await self._session.commit()
        await self._session.refresh(policy)
        return policy

    async def _seed_defaults(self, tenant_id: uuid.UUID) -> int:
        """Copy the platform's default entries into an organization that has none of them."""
        added = 0
        for item in SEED_BLOCKLIST:
            if await self._repo.get_entry_by_extension_id(tenant_id, item["extension_id"]):
                continue
            self._repo.add_entry(ExtensionBlocklistEntry(tenant_id=tenant_id, **item))
            added += 1
        await self._repo.flush()
        return added

    async def seed_new_organization(self, tenant_id: uuid.UUID) -> None:
        """Called when an organization is created, inside its creating transaction (no commit)."""
        await self._repo.ensure_org_policy_row(tenant_id)
        policy = await self._repo.get_org_policy(tenant_id, for_update=True)
        if policy is not None and policy.blocklist_seeded_at is None:
            await self._seed_defaults(tenant_id)
            policy.blocklist_seeded_at = _now()
            await self._session.flush()

    async def _locked_policy(self, tenant_id: uuid.UUID) -> ExtensionOrgPolicy:
        """The organization's policy row, locked until this transaction ends. Edits take it so
        two Admins cannot race past the entry cap or bump the version out of step."""
        await self.ensure_defaults(tenant_id)
        policy = await self._repo.get_org_policy(tenant_id, for_update=True)
        if policy is None:
            raise NotFoundError(public_message="Organization not found")
        return policy

    # ── public (interview page) ───────────────────────────────────────────

    async def _resolve(self, token: str) -> InterviewPolicy:
        interview = await self._require_open_session(token)
        job = await self._session.get(Job, interview.job_id)
        if job is None:
            raise NotFoundError(public_message="Interview session not found")
        org = await self.ensure_defaults(job.tenant_id)
        return InterviewPolicy(interview=interview, job=job, org=org)

    @staticmethod
    def _stamp(ctx: InterviewPolicy) -> None:
        """Record on the interview what the check is set to right now (the report reads it)."""
        ctx.interview.extension_check_enabled = ctx.enabled
        ctx.interview.extension_check_mode = ctx.mode
        ctx.interview.extension_policy_version = ctx.org.version

    async def stamp_interview(self, interview: InterviewSession, job: Job) -> None:
        """Stamp an interview as it starts. Joins the caller's transaction (no commit)."""
        org = await self.ensure_defaults(job.tenant_id)
        interview.extension_check_enabled = bool(job.extension_check_enabled)
        interview.extension_check_mode = job.extension_check_mode or DEFAULT_MODE
        interview.extension_policy_version = org.version

    async def policy_for_interview(self, token: str) -> IntegrityPolicyResponse:
        ctx = await self._resolve(token)
        self._stamp(ctx)
        await self._session.commit()
        if not ctx.enabled:
            return IntegrityPolicyResponse(
                enabled=False,
                version=ctx.org.version,
                mode=ctx.mode,  # type: ignore[arg-type]
                blocklist=[],
                rules=PolicyRules.model_validate(neutral_rules()),
            )
        entries = await self._repo.list_blocklist(ctx.tenant_id, active_only=True)
        return IntegrityPolicyResponse(
            enabled=True,
            version=ctx.org.version,
            mode=ctx.mode,  # type: ignore[arg-type]
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
            rules=PolicyRules.model_validate(default_rules()),
        )

    async def record_scan(self, token: str, body: IntegrityScanIn) -> IntegrityScanAck:
        ctx = await self._resolve(token)
        if not ctx.enabled:
            # The job's check is off. A page that is out of date (or a direct call) must not
            # leave evidence of a check that does not apply to this interview.
            self._stamp(ctx)
            await self._session.commit()
            return IntegrityScanAck(outcome="clear", recorded=False)

        outcome = compute_outcome(body.scan_completed, body.flagged)
        # The description belongs to the extension, not to this interview: it is
        # kept once in the catalog, so the per-interview evidence stays small.
        flagged = [f.model_dump(exclude={"description"}) for f in body.flagged]
        client_time = body.checked_at
        if client_time is not None and client_time.tzinfo is None:
            client_time = client_time.replace(tzinfo=timezone.utc)

        self._stamp(ctx)
        self._repo.add_scan(
            InterviewIntegrityScan(
                interview_session_id=ctx.interview.id,
                phase=body.phase,
                outcome=outcome,
                flagged=flagged,
                flagged_count=len(flagged),
                # A page that could not fetch the policy has no version or mode to report: the
                # scan then records what the interview was set to.
                policy_version=body.policy_version if body.policy_version is not None else ctx.org.version,
                mode=body.mode or ctx.mode,
                error_code=body.error_code,
                client_checked_at=client_time,
            )
        )
        await self._record_observed(ctx.tenant_id, body)
        await self._session.commit()
        return IntegrityScanAck(outcome=outcome)  # type: ignore[arg-type]

    async def _record_observed(self, tenant_id: uuid.UUID, body: IntegrityScanIn) -> None:
        """Fold flagged extensions into the organization's catalog.

        Isolated in a savepoint: the catalog is a convenience, the scan is
        evidence. A catalog failure must never cost the interview its record.
        """
        if not body.flagged:
            return
        try:
            async with self._session.begin_nested():
                await self._observed.record(tenant_id, body.flagged)
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

    # ── organization settings (Admins edit, HR views) ─────────────────────

    async def get_org_policy(self, actor: User, *, can_edit: bool) -> OrgPolicyResponse:
        policy = await self.ensure_defaults(actor.tenant_id)
        active, total = await self._repo.count_blocklist(actor.tenant_id)
        entries = await self._repo.list_blocklist(actor.tenant_id)
        return OrgPolicyResponse(
            version=policy.version,
            entry_count=total,
            active_count=active,
            defaults_present=sum(1 for e in entries if e.extension_id in _SEED_IDS),
            defaults_total=len(_SEED_IDS),
            can_edit=can_edit,
            updated_at=policy.updated_at or _now(),
        )

    async def list_blocklist(self, tenant_id: uuid.UUID) -> list[ExtensionBlocklistEntry]:
        await self.ensure_defaults(tenant_id)
        return await self._repo.list_blocklist(tenant_id)

    async def _add_locked(
        self,
        policy: ExtensionOrgPolicy,
        admin: User,
        fields: dict[str, Any],
    ) -> ExtensionBlocklistEntry:
        """Add one entry while the policy row is locked: the cap and the duplicate check are
        decided against a list nobody else can change."""
        tenant_id = admin.tenant_id
        _, total = await self._repo.count_blocklist(tenant_id)
        if total >= MAX_BLOCKLIST_ENTRIES:
            raise ConflictError(
                public_message=f"The list is full ({MAX_BLOCKLIST_ENTRIES} extensions). Delete one to add another."
            )
        if await self._repo.get_entry_by_extension_id(tenant_id, fields["extension_id"]):
            raise ConflictError(public_message="That extension is already on the list")
        entry = self._repo.add_entry(
            ExtensionBlocklistEntry(
                tenant_id=tenant_id,
                created_by_user_id=admin.id,
                updated_by_user_id=admin.id,
                **fields,
            )
        )
        try:
            await self._repo.flush()
        except IntegrityError as exc:  # the unique constraint, as a last line of defence
            await self._session.rollback()
            raise ConflictError(public_message="That extension is already on the list") from exc
        policy.version += 1
        policy.updated_by_user_id = admin.id
        await self._audit.log_change(
            actor=admin,
            action="settings.extension_blocklist_added",
            entity_type="extension_blocklist",
            entity_id=entry.id,
            subject_label=entry.name,
            feature="extension_check",
            before=None,
            after={"extension_id": entry.extension_id, "status": entry.status},
        )
        return entry

    async def add_entry(self, body: BlocklistEntryCreate, admin: User) -> ExtensionBlocklistEntry:
        policy = await self._locked_policy(admin.tenant_id)
        fields = body.model_dump()
        fields["origin"] = "custom"
        entry = await self._add_locked(policy, admin, fields)
        await self._session.commit()
        await self._session.refresh(entry)
        return entry

    async def update_entry(
        self, entry_id: uuid.UUID, body: BlocklistEntryUpdate, admin: User
    ) -> ExtensionBlocklistEntry:
        policy = await self._locked_policy(admin.tenant_id)
        entry = await self._repo.get_entry(admin.tenant_id, entry_id)
        if entry is None:
            raise NotFoundError(public_message="Blocklist entry not found")
        before = {
            "name": entry.name,
            "status": entry.status,
            "category": entry.category,
            "reason": entry.reason,
        }
        for field, value in body.model_dump(exclude_unset=True).items():
            if value is not None or field in ("listing_url", "verified_on"):
                setattr(entry, field, value)
        after = {
            "name": entry.name,
            "status": entry.status,
            "category": entry.category,
            "reason": entry.reason,
        }
        if before != after or body.model_fields_set & {"listing_url", "verified_on"}:
            entry.updated_by_user_id = admin.id
            policy.version += 1
            policy.updated_by_user_id = admin.id
            await self._audit.log_change(
                actor=admin,
                action="settings.extension_blocklist_updated",
                entity_type="extension_blocklist",
                entity_id=entry.id,
                subject_label=entry.name,
                feature="extension_check",
                before=before,
                after=after,
            )
        await self._session.commit()
        await self._session.refresh(entry)
        return entry

    async def delete_entry(self, entry_id: uuid.UUID, admin: User) -> None:
        policy = await self._locked_policy(admin.tenant_id)
        entry = await self._repo.get_entry(admin.tenant_id, entry_id)
        if entry is None:
            raise NotFoundError(public_message="Blocklist entry not found")
        label, ext_id = entry.name, entry.extension_id
        await self._repo.delete_entry(entry)
        policy.version += 1
        policy.updated_by_user_id = admin.id
        await self._audit.log_change(
            actor=admin,
            action="settings.extension_blocklist_deleted",
            entity_type="extension_blocklist",
            entity_id=entry_id,
            subject_label=label,
            feature="extension_check",
            before={"extension_id": ext_id},
            after=None,
        )
        await self._session.commit()

    async def restore_defaults(self, admin: User) -> RestoreDefaultsResult:
        """Bring back what is missing from the platform's default list.

        Re-adds a default that was deleted and turns back on one that was switched off. Custom
        entries, and any wording an Admin changed on a default, are left alone.
        """
        policy = await self._locked_policy(admin.tenant_id)
        tenant_id = admin.tenant_id
        added = reset = unchanged = 0
        _, total = await self._repo.count_blocklist(tenant_id)
        for item in SEED_BLOCKLIST:
            existing = await self._repo.get_entry_by_extension_id(tenant_id, item["extension_id"])
            if existing is None:
                if total >= MAX_BLOCKLIST_ENTRIES:
                    raise ConflictError(
                        public_message="The list is too full to restore every default. Delete some entries first."
                    )
                self._repo.add_entry(
                    ExtensionBlocklistEntry(
                        tenant_id=tenant_id,
                        created_by_user_id=admin.id,
                        updated_by_user_id=admin.id,
                        **item,
                    )
                )
                total += 1
                added += 1
            elif existing.status != "active":
                existing.status = "active"
                existing.updated_by_user_id = admin.id
                reset += 1
            else:
                unchanged += 1
        if added or reset:
            await self._repo.flush()
            policy.version += 1
            policy.updated_by_user_id = admin.id
            await self._audit.log_change(
                actor=admin,
                action="settings.extension_defaults_restored",
                entity_type="settings",
                entity_id=None,
                subject_label="AI extension blocklist",
                feature="extension_check",
                before=None,
                after={"added": added, "reset": reset},
            )
        await self._session.commit()
        return RestoreDefaultsResult(added=added, reset=reset, unchanged=unchanged)

    async def add_observed_to_blocklist(
        self, row_id: uuid.UUID, body: AddObservedToBlocklist, admin: User
    ) -> ExtensionBlocklistEntry:
        """Put a seen extension on the blocklist, in one transaction."""
        policy = await self._locked_policy(admin.tenant_id)
        row = await self._observed.require(admin.tenant_id, row_id)
        entry = await self._add_locked(
            policy,
            admin,
            {
                "extension_id": row.extension_id,
                "name": row.name,
                "category": body.category,
                "reason": body.reason or _DEFAULT_REASON.get(row.strongest_reason, _DEFAULT_REASON["heuristic_weak"]),
                "listing_url": listing_url(row.extension_id),
                "status": "active",
                "origin": "custom",
            },
        )
        await self._session.commit()
        await self._session.refresh(entry)
        return entry

