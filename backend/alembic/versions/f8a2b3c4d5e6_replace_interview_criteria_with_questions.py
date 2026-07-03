"""replace interview_evaluation_criteria with interview_questions JSON

Revision ID: f8a2b3c4d5e6
Revises: c3d4e5f6a7b8
Create Date: 2026-07-03

Replaces free-text interview_evaluation_criteria with structured interview_questions rubric.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "f8a2b3c4d5e6"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("interview_questions", JSONB, nullable=True),
    )
    op.drop_column("jobs", "interview_evaluation_criteria")


def downgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("interview_evaluation_criteria", sa.Text(), nullable=True),
    )
    op.drop_column("jobs", "interview_questions")
