"""add interview_queued_at to screening_calls

Revision ID: g1h2i3j4k5l6
Revises: a9b1c2d3e4f5
Create Date: 2026-07-03

HR explicitly queues a passed screening candidate for the interview pipeline.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "g1h2i3j4k5l6"
down_revision: Union[str, None] = "a9b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "screening_calls",
        sa.Column("interview_queued_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("screening_calls", "interview_queued_at")
