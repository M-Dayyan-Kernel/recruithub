"""extension check: organization blocklist, org policy, per-job switch

Revision ID: n0o1p2q3r4s5
Revises: m9n0o1p2q3r4
Create Date: 2026-10-29

Moves AI-extension detection from one platform-wide setting to the organization and the job.
Every organization gets its own copy of the blocklist and its own policy row; each job gets an
on/off switch and a mode (copied from the old global mode, so nothing changes for jobs that
already exist). The global `extension_policy` table is left in place and dropped in a later
revision, once this one is live.

The seen-extensions catalog cannot be attributed to an organization, so it is emptied.
Downgrade is best effort and lossy: per-organization lists collapse to the platform's.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "n0o1p2q3r4s5"
down_revision: Union[str, None] = "m9n0o1p2q3r4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Snapshot of the default blocklist at the time of this migration (id, name, category, reason).
# Deliberately not imported from app code: a migration must not change when the code does.
_DEFAULTS = [
    ('ofpnmcalabcbjgholdjcjblkibolbppb', 'Monica: All-In-One AI Assist & Smartest AI Agent', 'ai_assistant', 'AI assistant that adds a sidebar and overlays to pages and can answer questions as you browse.'),
    ('lfbbdphejjjanjiohlmkdbapdmfoaeem', 'Final Round AI', 'interview_assistant', 'Interview copilot that provides real-time answers and coaching during interviews.'),
    ('ibdllmhlcnecbccejcjbpdldgjnohpoc', 'Interview Copilot', 'interview_assistant', 'Listens to interview questions and generates suggested answers in real time.'),
    ('jkmbojgnflgmonjnpemjoidfmhjofbaa', 'AI Interview Helper', 'interview_assistant', 'Provides live interview analysis and response suggestions during interviews.'),
    ('bankjceeoiajhanakmghlbnahahkmaic', 'Interview Buddy - Your AI Interview Copilot', 'interview_assistant', 'Transcribes interviewer audio and shows suggested answers in a floating overlay.'),
    ('amgblhcclnikballgldanljepeplfdkh', 'VoiceMeetAI - AI Interview Assistant', 'interview_assistant', 'Transcribes tab audio and generates answers during interviews.'),
    ('difoiogjjojoaoomphldepapgpbgkhkb', 'Sider: Chat with all AI', 'ai_assistant', 'General-purpose AI sidebar that can read the page and answer questions.'),
    ('mhnlakgilnojmhinhkckjpncpbhabphi', 'MaxAI: Ask AI anything as you browse', 'ai_assistant', 'General-purpose AI sidebar and context menu that can read the page.'),
    ('camppjleccjaphfdbohjdohecfnoikec', 'Merlin AI', 'ai_assistant', 'General-purpose AI assistant that can read the page and answer questions.'),
    ('pokdnpkcjeekgiiokkdkdghpkcpfjgdh', 'AI Interview Copilot', 'interview_assistant', 'AI interview assistant that generates and analyses answers.'),
]
_CHROME_STORE = "https://chromewebstore.google.com/detail/"
_VERIFIED_ON = date(2026, 10, 12)


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _indexes(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc)

    global_mode, global_version = "shadow", 1
    if "extension_policy" in _tables():
        row = bind.execute(sa.text("SELECT mode, version FROM extension_policy LIMIT 1")).first()
        if row:
            global_mode = row[0] if row[0] in ("shadow", "enforce") else "shadow"
            global_version = int(row[1] or 1)

    # ── org policy ────────────────────────────────────────────────────────
    if "extension_org_policy" not in _tables():
        op.create_table(
            "extension_org_policy",
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("default_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("default_mode", sa.String(10), nullable=False, server_default="shadow"),
            sa.Column("heuristics_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("blocklist_seeded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
            sa.Column(
                "updated_by_user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )

    # ── jobs ──────────────────────────────────────────────────────────────
    job_cols = _columns("jobs")
    if "extension_check_enabled" not in job_cols:
        op.add_column(
            "jobs",
            sa.Column("extension_check_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
    if "extension_check_mode" not in job_cols:
        op.add_column(
            "jobs",
            sa.Column("extension_check_mode", sa.String(10), nullable=False, server_default="shadow"),
        )
        # Existing jobs keep the behaviour they have today.
        bind.execute(sa.text("UPDATE jobs SET extension_check_mode = :m"), {"m": global_mode})

    # ── interview stamps (null = interview predates the per-job check) ────
    session_cols = _columns("interview_sessions")
    for name, type_ in (
        ("extension_check_enabled", sa.Boolean()),
        ("extension_check_mode", sa.String(10)),
        ("extension_policy_version", sa.Integer()),
    ):
        if name not in session_cols:
            op.add_column("interview_sessions", sa.Column(name, type_, nullable=True))

    # ── blocklist: one copy per organization ──────────────────────────────
    block_cols = _columns("extension_blocklist")
    if "tenant_id" not in block_cols:
        for col in (
            sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("origin", sa.String(10), nullable=False, server_default="custom"),
            sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        ):
            op.add_column("extension_blocklist", col)

        # The old one-row-per-extension index would reject the per-organization copies.
        if "ix_extension_blocklist_extension_id" in _indexes("extension_blocklist"):
            op.drop_index("ix_extension_blocklist_extension_id", table_name="extension_blocklist")

        globals_ = bind.execute(
            sa.text(
                "SELECT extension_id, name, category, reason, listing_url, status, verified_on "
                "FROM extension_blocklist WHERE tenant_id IS NULL"
            )
        ).mappings().all()
        tenant_ids = [r[0] for r in bind.execute(sa.text("SELECT id FROM tenants"))]
        default_by_id = {d[0]: d for d in _DEFAULTS}

        insert = sa.text(
            "INSERT INTO extension_blocklist (id, tenant_id, extension_id, name, category, reason, "
            "listing_url, status, origin, verified_on) VALUES (:id, :tenant_id, :extension_id, "
            ":name, :category, :reason, :listing_url, :status, :origin, :verified_on)"
        )
        batch = []
        for tenant_id in tenant_ids:
            for g in globals_:
                d = default_by_id.get(g["extension_id"])
                unchanged = d is not None and g["name"] == d[1] and g["reason"] == d[3]
                batch.append(
                    {
                        "id": uuid.uuid4(),
                        "tenant_id": tenant_id,
                        "extension_id": g["extension_id"],
                        "name": g["name"],
                        "category": g["category"],
                        "reason": g["reason"],
                        "listing_url": g["listing_url"],
                        "status": g["status"],
                        "origin": "default" if unchanged else "custom",
                        "verified_on": g["verified_on"],
                    }
                )
        if batch:
            bind.execute(insert, batch)
        bind.execute(sa.text("DELETE FROM extension_blocklist WHERE tenant_id IS NULL"))

        # An install that never opened the old page has no global rows: give those tenants the
        # defaults here, so every tenant is seeded exactly once.
        if not globals_:
            fallback = [
                {
                    "id": uuid.uuid4(),
                    "tenant_id": tenant_id,
                    "extension_id": d[0],
                    "name": d[1],
                    "category": d[2],
                    "reason": d[3],
                    "listing_url": _CHROME_STORE + d[0],
                    "status": "active",
                    "origin": "default",
                    "verified_on": _VERIFIED_ON,
                }
                for tenant_id in tenant_ids
                for d in _DEFAULTS
            ]
            if fallback:
                bind.execute(insert, fallback)

        op.alter_column("extension_blocklist", "tenant_id", nullable=False)
        op.create_foreign_key(
            "fk_extension_blocklist_tenant_id",
            "extension_blocklist",
            "tenants",
            ["tenant_id"],
            ["id"],
            ondelete="CASCADE",
        )
        for col in ("created_by_user_id", "updated_by_user_id"):
            op.create_foreign_key(
                f"fk_extension_blocklist_{col}",
                "extension_blocklist",
                "users",
                [col],
                ["id"],
                ondelete="SET NULL",
            )
        op.create_unique_constraint(
            "uq_extension_blocklist_tenant_extension",
            "extension_blocklist",
            ["tenant_id", "extension_id"],
        )
        op.create_index(
            "ix_extension_blocklist_tenant_status",
            "extension_blocklist",
            ["tenant_id", "status"],
        )

    # ── one policy row per organization, already seeded ───────────────────
    bind.execute(
        sa.text(
            "INSERT INTO extension_org_policy (tenant_id, default_mode, version, blocklist_seeded_at) "
            "SELECT id, :mode, :version, :now FROM tenants "
            "ON CONFLICT (tenant_id) DO NOTHING"
        ),
        {"mode": global_mode, "version": global_version + 1, "now": now},
    )

    # ── seen extensions: per organization, starting empty ─────────────────
    if "tenant_id" not in _columns("observed_extensions"):
        bind.execute(sa.text("DELETE FROM observed_extensions"))
        op.add_column(
            "observed_extensions",
            sa.Column(
                "tenant_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("tenants.id", ondelete="CASCADE"),
                nullable=False,
            ),
        )
        existing = _indexes("observed_extensions")
        if "ix_observed_extensions_extension_id" in existing:
            op.drop_index("ix_observed_extensions_extension_id", table_name="observed_extensions")
        if "ix_observed_extensions_status_last_seen" in existing:
            op.drop_index("ix_observed_extensions_status_last_seen", table_name="observed_extensions")
        op.create_unique_constraint(
            "uq_observed_extensions_tenant_extension",
            "observed_extensions",
            ["tenant_id", "extension_id"],
        )
        op.create_index(
            "ix_observed_extensions_tenant_status_last_seen",
            "observed_extensions",
            ["tenant_id", "status", "last_seen_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()

    if "tenant_id" in _columns("observed_extensions"):
        bind.execute(sa.text("DELETE FROM observed_extensions"))
        op.drop_index("ix_observed_extensions_tenant_status_last_seen", table_name="observed_extensions")
        op.drop_constraint("uq_observed_extensions_tenant_extension", "observed_extensions", type_="unique")
        op.drop_column("observed_extensions", "tenant_id")
        op.create_index(
            "ix_observed_extensions_extension_id", "observed_extensions", ["extension_id"], unique=True
        )
        op.create_index(
            "ix_observed_extensions_status_last_seen",
            "observed_extensions",
            ["status", "last_seen_at"],
        )

    if "tenant_id" in _columns("extension_blocklist"):
        # Keep one row per extension (the Platform organization's list if it has one).
        bind.execute(
            sa.text(
                "DELETE FROM extension_blocklist b USING tenants t "
                "WHERE b.tenant_id = t.id AND t.slug <> 'platform'"
            )
        )
        bind.execute(
            sa.text(
                "DELETE FROM extension_blocklist a USING extension_blocklist b "
                "WHERE a.extension_id = b.extension_id AND a.id > b.id"
            )
        )
        op.drop_index("ix_extension_blocklist_tenant_status", table_name="extension_blocklist")
        op.drop_constraint("uq_extension_blocklist_tenant_extension", "extension_blocklist", type_="unique")
        for name in (
            "fk_extension_blocklist_updated_by_user_id",
            "fk_extension_blocklist_created_by_user_id",
            "fk_extension_blocklist_tenant_id",
        ):
            op.drop_constraint(name, "extension_blocklist", type_="foreignkey")
        for col in ("updated_by_user_id", "created_by_user_id", "origin", "tenant_id"):
            op.drop_column("extension_blocklist", col)
        op.create_index(
            "ix_extension_blocklist_extension_id", "extension_blocklist", ["extension_id"], unique=True
        )

    for col in ("extension_policy_version", "extension_check_mode", "extension_check_enabled"):
        if col in _columns("interview_sessions"):
            op.drop_column("interview_sessions", col)
    for col in ("extension_check_mode", "extension_check_enabled"):
        if col in _columns("jobs"):
            op.drop_column("jobs", col)

    if "extension_org_policy" in _tables():
        op.drop_table("extension_org_policy")
