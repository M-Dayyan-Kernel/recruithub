"""compatibility revision for pre-existing dev databases

Revision ID: a7c3d9e4f1b2
Revises: 0001
Create Date: 2026-06-30

This revision intentionally makes no schema changes. It exists so local
databases stamped with a stale revision can still be upgraded to head after
the migration history was flattened in this repository snapshot.
"""
from __future__ import annotations

from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'a7c3d9e4f1b2'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass