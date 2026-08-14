"""Integration link / flow / event models — POC side of the one-click connect.

Mirror of talentOS's ``integration_link_model``, inverted for the POC's role as
the connect *initiator*. The ``integration_links`` row is the durable
relationship; ``integration_link_flows`` records each connect/disconnect
operation (state, attempts, backoff); ``integration_link_events`` is the
append-only audit trail.

Transient peer-key storage: ``tal_key_enc`` holds the talentOS-issued ``tal_``
key (Fernet-encrypted) **only while a flow is TRANSIENT** (for replay). On
``linked`` / ``failed`` the column is cleared so no stale credential can be
resurrected. The POC-issued ``rhub_`` key lives in ``api_keys`` (referenced by
``rhub_key_id``).

Provider on this side is ``talentos``; the talentOS side stores ``poc``. The
mutual-ping proof flags (``ping_a_verified`` / ``ping_b_verified``) mirror
talentOS exactly so the handshake is order-independent.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Providers (the discriminator column on each side) ─────────────────────────
PROVIDER_POC = "poc"
PROVIDER_TALENTOS = "talentos"

# ── Flow operations ────────────────────────────────────────────────────────────
OPERATION_CONNECT = "connect"
OPERATION_DISCONNECT = "disconnect"

# ── States (shared by link mirror + flow rows) ─────────────────────────────────
STATE_NONE = "none"
STATE_KEYS_ISSUED = "keys_issued"
STATE_PROVISIONING = "provisioning"
STATE_KEYS_EXCHANGED = "keys_exchanged"
STATE_VERIFYING = "verifying"
STATE_LINKED = "linked"
STATE_FAILED = "failed"
STATE_DISCONNECTING = "disconnecting"
STATE_DISCONNECTED = "disconnected"

# Reconciler retries these automatically (backoff, attempts cap).
TRANSIENT_STATES: frozenset[str] = frozenset(
    {
        STATE_KEYS_ISSUED,
        STATE_PROVISIONING,
        STATE_KEYS_EXCHANGED,
        STATE_VERIFYING,
        STATE_DISCONNECTING,
    }
)

# Reconciler stops here; only a user action (Retry / Disconnect) moves them.
TERMINAL_STATES: frozenset[str] = frozenset(
    {STATE_NONE, STATE_LINKED, STATE_FAILED, STATE_DISCONNECTED}
)

# States in which the peer key plaintext (enc) may still be present and replayable.
REPLAYABLE_STATES: frozenset[str] = frozenset(
    {STATE_KEYS_ISSUED, STATE_PROVISIONING, STATE_KEYS_EXCHANGED, STATE_VERIFYING}
)


class IntegrationLink(Base):
    """Durable relationship: one POC tenant <-> one talentOS tenant.

    ``state`` is a cached mirror of the current flow's state. ``current_flow_id``
    points at the most recent flow (idempotency + ping binding key).
    """

    __tablename__ = "integration_links"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    tenant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    external_tenant_id: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[str] = mapped_column(
        String(50), nullable=False, default=STATE_NONE, server_default=STATE_NONE
    )
    current_flow_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    # rhub_ is the key this POC issued (local FK -> api_keys).
    rhub_key_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("api_keys.id", ondelete="SET NULL"),
        nullable=True,
    )
    # tal_ is the key talentOS issued (foreign id — echoed, no local FK).
    tal_key_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Fernet-encrypted plaintext — TRANSIENT-only (replay), cleared on linked/failed.
    tal_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    connected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "provider", "tenant_id", name="uq_integration_link_provider_tenant"
        ),
        Index(
            "uq_integration_links_current_flow",
            "current_flow_id",
            unique=True,
            postgresql_where=text("current_flow_id IS NOT NULL"),
        ),
    )


class IntegrationLinkFlow(Base):
    """One connect/disconnect operation on a link (idempotency key = flow_id)."""

    __tablename__ = "integration_link_flows"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    flow_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False, default=uuid4, unique=True, index=True
    )
    link_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("integration_links.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    operation: Mapped[str] = mapped_column(String(20), nullable=False)
    state: Mapped[str] = mapped_column(String(50), nullable=False)
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Mutual-ping proof flags. ping_a = talentOS -> POC (rhub_); ping_b = POC ->
    # talentOS (tal_). Reach ``linked`` only when both are true.
    ping_a_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    ping_b_verified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_integration_link_flows_state_retry", "state", "next_retry_at"),
    )


class IntegrationLinkEvent(Base):
    """Append-only audit for the connect/disconnect lifecycle.

    ``detail`` must never contain credentials, Authorization headers, Fernet
    plaintext, or raw exception/request bodies (sanitize before writing).
    """

    __tablename__ = "integration_link_events"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    link_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("integration_links.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    flow_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    actor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str | None] = mapped_column(String(50), nullable=True)
    result: Mapped[str | None] = mapped_column(String(20), nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
