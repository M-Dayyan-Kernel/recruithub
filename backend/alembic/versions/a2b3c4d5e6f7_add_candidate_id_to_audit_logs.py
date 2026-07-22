"""add candidate_id to audit_logs

Revision ID: a2b3c4d5e6f7
Revises: z1a2b3c4d5e6
Create Date: 2026-07-22

Adds candidate_id column for filtering activity logs by candidate.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, None] = "z1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _column_exists("audit_logs", "candidate_id"):
        op.add_column(
            "audit_logs",
            sa.Column("candidate_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
        op.create_index("ix_audit_logs_candidate_id", "audit_logs", ["candidate_id"])


def downgrade() -> None:
    if _column_exists("audit_logs", "candidate_id"):
        op.drop_index("ix_audit_logs_candidate_id", table_name="audit_logs")
        op.drop_column("audit_logs", "candidate_id")
