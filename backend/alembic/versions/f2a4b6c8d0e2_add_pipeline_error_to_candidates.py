"""add pipeline_error to candidates

Revision ID: f2a4b6c8d0e2
Revises: e7a3d1f2b6c8
Create Date: 2026-09-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2a4b6c8d0e2"
down_revision: Union[str, None] = "e7a3d1f2b6c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column("pipeline_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("candidates", "pipeline_error")
