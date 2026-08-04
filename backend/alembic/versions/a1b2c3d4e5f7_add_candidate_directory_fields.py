"""add candidate directory fields for centralized module

Revision ID: a1b2c3d4e5f7
Revises: z1a2b3c4d5e6
Create Date: 2026-08-03

Adds HR-editable list/profile columns on candidates.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, None] = "z1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column("status", sa.String(50), nullable=False, server_default="active"),
    )
    op.add_column("candidates", sa.Column("years_experience", sa.Float(), nullable=True))
    op.add_column("candidates", sa.Column("current_ctc", sa.String(100), nullable=True))
    op.add_column("candidates", sa.Column("expected_ctc", sa.String(100), nullable=True))
    op.add_column("candidates", sa.Column("notice_period", sa.String(100), nullable=True))
    op.add_column("candidates", sa.Column("last_working_day", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("candidates", "last_working_day")
    op.drop_column("candidates", "notice_period")
    op.drop_column("candidates", "expected_ctc")
    op.drop_column("candidates", "current_ctc")
    op.drop_column("candidates", "years_experience")
    op.drop_column("candidates", "status")
