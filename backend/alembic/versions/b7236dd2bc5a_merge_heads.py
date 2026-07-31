"""merge heads

Revision ID: b7236dd2bc5a
Revises: a0b1c2d3e4f5, a2b3c4d5e6f7
Create Date: 2026-07-30 18:37:15.016535

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7236dd2bc5a'
down_revision: Union[str, None] = ('a0b1c2d3e4f5', 'a2b3c4d5e6f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
