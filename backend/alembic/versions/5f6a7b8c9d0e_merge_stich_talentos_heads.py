"""merge stich/talentos migration heads

Revision ID: 5f6a7b8c9d0e
Revises: a2d9b9ebfc18, x3y4z5a6b7c8
Create Date: 2026-08-11 13:30:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5f6a7b8c9d0e'
down_revision: Union[str, None] = ('a2d9b9ebfc18', 'x3y4z5a6b7c8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
