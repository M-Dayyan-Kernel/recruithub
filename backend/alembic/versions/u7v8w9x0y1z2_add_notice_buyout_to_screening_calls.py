"""add notice_buyout to screening_calls

Revision ID: u7v8w9x0y1z2
Revises: t6u7v8w9x0y1
Create Date: 2026-11-21

The screening call asks "Does your company offer a notice period buyout?" when the candidate's
notice period is over 30 days. This holds the extracted answer. Null means it was not asked, which
is every call made before this column existed.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "u7v8w9x0y1z2"
down_revision: Union[str, None] = "t6u7v8w9x0y1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("screening_calls", sa.Column("notice_buyout", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("screening_calls", "notice_buyout")
