"""extension integrity: blocklist, policy, interview scans

Revision ID: j6k7l8m9n0o1
Revises: i5j6k7l8m9n0
Create Date: 2026-10-13

Moves the AI-assistant extension blocklist out of the browser extension build
into the database (editable by a Super Admin, no release), adds the single-row
detection policy, and records each interview's extension scans as evidence for
HR. Defaults are seeded lazily by the application, not here.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "j6k7l8m9n0o1"
down_revision: Union[str, None] = "i5j6k7l8m9n0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _tables()

    if "extension_blocklist" not in existing:
        op.create_table(
            "extension_blocklist",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("extension_id", sa.String(64), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("category", sa.String(30), nullable=False),
            sa.Column("reason", sa.String(500), nullable=False),
            sa.Column("listing_url", sa.String(500), nullable=True),
            sa.Column("status", sa.String(10), nullable=False, server_default="active"),
            sa.Column("verified_on", sa.Date(), nullable=True),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
        )
        op.create_index(
            "ix_extension_blocklist_extension_id", "extension_blocklist", ["extension_id"], unique=True
        )

    if "extension_policy" not in existing:
        op.create_table(
            "extension_policy",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("mode", sa.String(10), nullable=False, server_default="shadow"),
            sa.Column("rules", sa.JSON(), nullable=False),
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

    if "interview_integrity_scans" not in existing:
        op.create_table(
            "interview_integrity_scans",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "interview_session_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("phase", sa.String(20), nullable=False),
            sa.Column("outcome", sa.String(20), nullable=False),
            sa.Column("flagged", sa.JSON(), nullable=False),
            sa.Column("flagged_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("policy_version", sa.Integer(), nullable=True),
            sa.Column("mode", sa.String(10), nullable=True),
            sa.Column("error_code", sa.String(40), nullable=True),
            sa.Column("client_checked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
        )
        op.create_index(
            "ix_interview_integrity_scans_interview_session_id",
            "interview_integrity_scans",
            ["interview_session_id"],
        )


def downgrade() -> None:
    existing = _tables()
    if "interview_integrity_scans" in existing:
        op.drop_index(
            "ix_interview_integrity_scans_interview_session_id",
            table_name="interview_integrity_scans",
        )
        op.drop_table("interview_integrity_scans")
    if "extension_policy" in existing:
        op.drop_table("extension_policy")
    if "extension_blocklist" in existing:
        op.drop_index("ix_extension_blocklist_extension_id", table_name="extension_blocklist")
        op.drop_table("extension_blocklist")
