"""add original_filename to candidates

Revision ID: d4f1a2b3c5e6
Revises: c9d1e2f3a4b5
Create Date: 2026-06-23

Adds original_filename column to candidates table.
Used for deduplication on re-upload (Sprint B task B-4).
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = "d4f1a2b3c5e6"
down_revision = "c9d1e2f3a4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column("original_filename", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("candidates", "original_filename")
