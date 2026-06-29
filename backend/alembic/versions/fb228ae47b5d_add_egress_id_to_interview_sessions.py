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
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'interview_sessions',
        sa.Column('egress_id', sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('interview_sessions', 'egress_id')
