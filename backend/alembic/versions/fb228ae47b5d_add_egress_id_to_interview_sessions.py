"""add_egress_id_to_interview_sessions

Revision ID: fb228ae47b5d
Revises: 0001
Create Date: 2026-06-22 20:35:42.947546

Adds egress_id column to interview_sessions to store the LiveKit Cloud
egress recording ID created when a room is started. NULL when recording
is not configured or not available.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'fb228ae47b5d'
down_revision: Union[str, None] = 'a7c3d9e4f1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _column_exists('interview_sessions', 'egress_id'):
        op.add_column(
            'interview_sessions',
            sa.Column('egress_id', sa.String(length=255), nullable=True),
        )


def downgrade() -> None:
    if _column_exists('interview_sessions', 'egress_id'):
        op.drop_column('interview_sessions', 'egress_id')
