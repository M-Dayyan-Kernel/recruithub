"""add screening_questions to jobs

Revision ID: a9b1c2d3e4f5
Revises: f8a2b3c4d5e6
Create Date: 2026-07-03

Replaces screening_criteria text with structured screening_questions JSON.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "a9b1c2d3e4f5"
down_revision: Union[str, None] = "f8a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("screening_questions", JSONB, nullable=True),
    )
    op.drop_column("jobs", "screening_criteria")


def downgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("screening_criteria", sa.Text(), nullable=True),
    )
    op.drop_column("jobs", "screening_questions")
