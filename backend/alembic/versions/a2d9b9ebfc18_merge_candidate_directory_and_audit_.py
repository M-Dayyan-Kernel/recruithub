"""merge candidate directory and audit candidate_id heads

Revision ID: a2d9b9ebfc18
Revises: a1b2c3d4e5f7, a2b3c4d5e6f7
Create Date: 2026-08-04 09:28:45.620504

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2d9b9ebfc18'
down_revision: Union[str, None] = ('a1b2c3d4e5f7', 'a2b3c4d5e6f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
