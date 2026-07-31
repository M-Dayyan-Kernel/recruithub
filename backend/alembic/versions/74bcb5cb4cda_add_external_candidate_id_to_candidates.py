"""add external_candidate_id to candidates

Revision ID: 74bcb5cb4cda
Revises: b7236dd2bc5a
Create Date: 2026-07-30 18:37:35.682389

"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '74bcb5cb4cda'
down_revision: Union[str, None] = 'b7236dd2bc5a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('candidates', sa.Column('external_candidate_id', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('candidates', 'external_candidate_id')
