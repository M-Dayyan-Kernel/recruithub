"""add pipeline_error to candidates

Revision ID: f2a4b6c8d0e2
Revises: c1d1e1f1a2b3
Create Date: 2026-09-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2a4b6c8d0e2"
down_revision: Union[str, None] = "c1d1e1f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: production DBs deployed from stich/talentos already carry
    # this column (added out-of-band), so only add it when it is missing.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("candidates")}
    if "pipeline_error" not in columns:
        op.add_column(
            "candidates",
            sa.Column("pipeline_error", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("candidates", "pipeline_error")
