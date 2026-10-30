"""Schemas for AI-assistant extension detection (org policy, blocklist, scans, report)."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_CHROME_EXTENSION_ID = re.compile(r"^[a-p]{32}$")

#: Entries one organization can keep. The list is sent to every candidate's browser.
MAX_BLOCKLIST_ENTRIES = 200

Mode = Literal["shadow", "enforce"]
BlocklistCategory = Literal["ai_assistant", "interview_assistant"]
BlocklistStatus = Literal["active", "inactive"]
BlocklistOrigin = Literal["default", "custom"]
ScanPhase = Literal["preflight", "final", "start"]
ScanOutcome = Literal["clear", "flagged", "blocked", "unavailable"]
ReasonCode = Literal["known_id", "heuristic_strong", "heuristic_weak"]


# ── rules ────────────────────────────────────────────────────────────────────


class KeywordRule(BaseModel):
    term: str = Field(..., min_length=1, max_length=60)
    weight: int = Field(..., ge=1, le=10)

    @field_validator("term")
    @classmethod
    def _normalise(cls, v: str) -> str:
        term = re.sub(r"\s+", " ", v).strip().lower()
        if not term:
            raise ValueError("Keyword cannot be blank")
        return term


class IntentRules(BaseModel):
    keywords: list[KeywordRule] = Field(default_factory=list, max_length=200)
    vendor_hosts: list[str] = Field(default_factory=list, max_length=100)
    vendor_host_weight: int = Field(4, ge=0, le=10)
    homepage_weight: int = Field(2, ge=0, le=10)

    @field_validator("vendor_hosts")
    @classmethod
    def _hosts(cls, hosts: list[str]) -> list[str]:
        cleaned: list[str] = []
        for raw in hosts:
            host = raw.strip().lower()
            if not 3 <= len(host) <= 100 or "/" in host or " " in host:
                raise ValueError(f"Invalid host: {raw!r}")
            if host not in cleaned:
                cleaned.append(host)
        return cleaned


class CapabilityRules(BaseModel):
    permissions: dict[str, int] = Field(default_factory=dict)
    broad_host_weight: int = Field(3, ge=0, le=10)

    @field_validator("permissions")
    @classmethod
    def _perms(cls, perms: dict[str, int]) -> dict[str, int]:
        if len(perms) > 50:
            raise ValueError("At most 50 permissions")
        for name, weight in perms.items():
            if not 1 <= len(name) <= 60:
                raise ValueError(f"Invalid permission name: {name!r}")
            if not 0 <= weight <= 10:
                raise ValueError(f"Weight for {name} must be between 0 and 10")
        return perms


class Thresholds(BaseModel):
    intent_strong: int = Field(4, ge=1, le=30)
    capability_strong: int = Field(3, ge=1, le=30)
    intent_weak: int = Field(2, ge=1, le=30)

    @model_validator(mode="after")
    def _ordered(self) -> "Thresholds":
        if self.intent_weak > self.intent_strong:
            raise ValueError("intent_weak cannot exceed intent_strong")
        return self


class PolicyRules(BaseModel):
    intent: IntentRules = Field(default_factory=IntentRules)
    capability: CapabilityRules = Field(default_factory=CapabilityRules)
    thresholds: Thresholds = Field(default_factory=Thresholds)


# ── blocklist ────────────────────────────────────────────────────────────────


class BlocklistEntryCreate(BaseModel):
    extension_id: str
    name: str = Field(..., min_length=1, max_length=255)
    category: BlocklistCategory = "ai_assistant"
    reason: str = Field(..., min_length=1, max_length=500)
    listing_url: Optional[str] = Field(None, max_length=500)
    status: BlocklistStatus = "active"
    verified_on: Optional[date] = None

    @field_validator("extension_id")
    @classmethod
    def _extension_id(cls, v: str) -> str:
        value = v.strip().lower()
        if not _CHROME_EXTENSION_ID.match(value):
            raise ValueError(
                "Extension ID must be the 32-letter ID from the Chrome Web Store URL"
            )
        return value

    @field_validator("name", "reason")
    @classmethod
    def _strip(cls, v: str) -> str:
        value = v.strip()
        if not value:
            raise ValueError("Cannot be blank")
        return value

    @field_validator("listing_url")
    @classmethod
    def _url(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not value:
            return None
        if not value.startswith(("https://", "http://")):
            raise ValueError("Listing URL must start with http:// or https://")
        return value


class BlocklistEntryUpdate(BaseModel):
    # The extension ID is what the entry is: to change it, delete the entry and add another.
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    category: Optional[BlocklistCategory] = None
    reason: Optional[str] = Field(None, min_length=1, max_length=500)
    listing_url: Optional[str] = Field(None, max_length=500)
    status: Optional[BlocklistStatus] = None
    verified_on: Optional[date] = None

    @field_validator("name", "reason")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not value:
            raise ValueError("Cannot be blank")
        return value


class BlocklistEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    extension_id: str
    name: str
    category: str
    reason: str
    listing_url: Optional[str] = None
    status: str
    origin: BlocklistOrigin = "custom"
    verified_on: Optional[date] = None
    created_at: datetime
    updated_at: datetime


# ── policy ───────────────────────────────────────────────────────────────────


class PublicBlocklistItem(BaseModel):
    id: str
    name: str
    category: str
    reason: str
    listing_url: Optional[str] = None


class IntegrityPolicyResponse(BaseModel):
    """What the interview page hands to the extension: active list + rules.

    `enabled` is false when the job's check is off: the page then skips the check altogether
    (the blocklist is empty and the rules are neutral, so a page that ignores the flag still
    parses a valid policy and finds nothing).
    """

    enabled: bool = True
    version: int
    mode: Mode
    blocklist: list[PublicBlocklistItem]
    rules: PolicyRules


class OrgPolicyResponse(BaseModel):
    """An organization's extension-check settings, for its Admins (edit) and HR (view)."""

    default_enabled: bool
    default_mode: Mode
    heuristics_enabled: bool
    version: int
    entry_count: int
    active_count: int
    entry_cap: int = MAX_BLOCKLIST_ENTRIES
    #: How many of the platform's default entries this list currently has, of how many exist.
    defaults_present: int
    defaults_total: int
    can_edit: bool
    updated_at: datetime


class OrgPolicyUpdate(BaseModel):
    default_enabled: Optional[bool] = None
    default_mode: Optional[Mode] = None
    heuristics_enabled: Optional[bool] = None


class RestoreDefaultsResult(BaseModel):
    added: int
    reset: int
    unchanged: int


# ── scans ────────────────────────────────────────────────────────────────────


class FlaggedExtensionIn(BaseModel):
    """One extension reported by the browser. Untrusted input: bounded and typed."""

    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    reason_code: ReasonCode
    blocked: bool = False
    would_block: bool = False
    intent_score: int = 0
    capability_score: int = 0
    signals: list[str] = Field(default_factory=list, max_length=12)
    #: The extension's own public description. Truncated, never rejected.
    description: Optional[str] = None

    @field_validator("description", mode="before")
    @classmethod
    def _tidy_description(cls, v):
        if not isinstance(v, str):
            return None
        text = re.sub(r"\s+", " ", v).strip()[:300]
        return text or None

    @field_validator("intent_score", "capability_score", mode="before")
    @classmethod
    def _bounded_score(cls, v):
        """Clamp rather than reject. Rules are admin-editable, so a legitimate
        score can exceed any fixed cap; rejecting would silently lose the
        evidence for exactly the extensions that matched the most."""
        try:
            n = int(v)
        except (TypeError, ValueError):
            return 0
        return max(0, min(n, 10_000))

    @field_validator("signals")
    @classmethod
    def _signals(cls, signals: list[str]) -> list[str]:
        return [s.strip()[:80] for s in signals if s and s.strip()]


class IntegrityScanIn(BaseModel):
    phase: ScanPhase
    scan_completed: bool
    checked_at: Optional[datetime] = None
    policy_version: Optional[int] = Field(None, ge=0)
    mode: Optional[Mode] = None
    error_code: Optional[str] = Field(None, max_length=40)
    flagged: list[FlaggedExtensionIn] = Field(default_factory=list, max_length=25)


class IntegrityScanAck(BaseModel):
    outcome: ScanOutcome
    recorded: bool = True


# ── report summary ───────────────────────────────────────────────────────────


class IntegrityFlaggedExtension(BaseModel):
    id: str
    name: str
    reason_code: str
    blocked: bool
    would_block: bool
    intent_score: int
    capability_score: int
    signals: list[str]
    first_seen_phase: str
    seen_in_scans: int


class IntegrityTimelineEntry(BaseModel):
    phase: str
    outcome: str
    flagged_count: int
    mode: Optional[str] = None
    at: datetime


class IntegritySummary(BaseModel):
    scans: int
    latest_outcome: str
    was_ever_blocked: bool
    unavailable_scans: int
    flagged_extensions: list[IntegrityFlaggedExtension]
    timeline: list[IntegrityTimelineEntry]
    #: One neutral, factual sentence for the report (never fed to scoring).
    note: Optional[str] = None
    #: The error code of the latest scan, e.g. "policy_unavailable" when the interview page could
    #: not fetch the policy and let the candidate in. Null for a normal scan.
    latest_error_code: Optional[str] = None


# ── observed extensions (one catalog per organization) ───────────────────────

ObservedStatus = Literal["new", "dismissed"]
ObservedReopenReason = Literal["content_changed", "stronger_match"]


class ObservedExtensionResponse(BaseModel):
    """What an organization's Admins and HR see. Facts about the extension only: no candidate,
    interview, job or user information exists on this row."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    extension_id: str
    name: str
    description: Optional[str] = None
    strongest_reason: str
    times_seen: int
    first_seen_at: datetime
    last_seen_at: datetime
    status: ObservedStatus
    reopened_reason: Optional[ObservedReopenReason] = None
    listing_url: Optional[str] = None


class ObservedExtensionPage(BaseModel):
    items: list[ObservedExtensionResponse]
    total: int
    limit: int
    offset: int


class AddObservedToBlocklist(BaseModel):
    """Optional wording for the entry made from a seen extension; defaults come from the row."""

    category: BlocklistCategory = "ai_assistant"
    reason: Optional[str] = Field(None, min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip()
        if not value:
            raise ValueError("Cannot be blank")
        return value
