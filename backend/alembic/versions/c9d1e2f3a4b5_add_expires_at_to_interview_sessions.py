"""add_expires_at_to_interview_sessions

Revision ID: c9d1e2f3a4b5
Revises: fb228ae47b5d
Create Date: 2026-06-23 14:00:00.000000

Adds expires_at column to interview_sessions to support link expiry
(7 days from when the interview link is sent). NULL for sessions
created before this migration (treated as non-expiring by old code).
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c9d1e2f3a4b5'
down_revision: Union[str, None] = 'fb228ae47b5d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _column_exists('interview_sessions', 'expires_at'):
        op.add_column(
            'interview_sessions',
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    if _column_exists('interview_sessions', 'expires_at'):
        op.drop_column('interview_sessions', 'expires_at')
