"""drop_resume_raw_text

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-07-17

Resume files are stored in object storage / local uploads; raw extracted text
is no longer persisted on candidates.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v6w7x8y9z0a1"
down_revision: Union[str, None] = "u5v6w7x8y9z0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if _column_exists("candidates", "resume_raw_text"):
        op.drop_column("candidates", "resume_raw_text")


def downgrade() -> None:
    if not _column_exists("candidates", "resume_raw_text"):
        op.add_column(
            "candidates",
            sa.Column("resume_raw_text", sa.Text(), nullable=True),
        )
