"""add work_mode and work_location to jobs

Nullable on purpose: jobs created before work modes existed have neither, and the screening
call's location question falls back to its generic wording until HR sets a mode.

Revision ID: m9n0o1p2q3r4
Revises: l8m9n0o1p2q3
Create Date: 2026-10-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "m9n0o1p2q3r4"
down_revision: Union[str, None] = "l8m9n0o1p2q3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("work_mode", sa.String(length=16), nullable=True))
    op.add_column("jobs", sa.Column("work_location", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "work_location")
    op.drop_column("jobs", "work_mode")
