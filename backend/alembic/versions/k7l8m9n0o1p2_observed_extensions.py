"""observed extensions catalog

Revision ID: k7l8m9n0o1p2
Revises: j6k7l8m9n0o1
Create Date: 2026-10-13

One row per distinct extension flagged on any candidate's browser, so a Super
Admin can review unknown AI-looking extensions and promote them to the
blocklist. Holds no candidate, interview, job or organization reference.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "k7l8m9n0o1p2"
down_revision: Union[str, None] = "j6k7l8m9n0o1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "observed_extensions" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "observed_extensions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("extension_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(300), nullable=True),
        sa.Column("strongest_reason", sa.String(20), nullable=False),
        sa.Column("times_seen", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="new"),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("known_hashes", sa.JSON(), nullable=False),
        sa.Column("dismissed_hash", sa.String(64), nullable=True),
        sa.Column("dismissed_reason", sa.String(20), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "dismissed_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reopened_reason", sa.String(30), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_observed_extensions_extension_id", "observed_extensions", ["extension_id"], unique=True
    )
    op.create_index(
        "ix_observed_extensions_status_last_seen",
        "observed_extensions",
        ["status", "last_seen_at"],
    )


def downgrade() -> None:
    if "observed_extensions" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_index("ix_observed_extensions_status_last_seen", table_name="observed_extensions")
        op.drop_index("ix_observed_extensions_extension_id", table_name="observed_extensions")
        op.drop_table("observed_extensions")
