"""add screening retry delays to system_settings

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-02

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_DELAYS = "[1800, 7200, 86400]"


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column(
            "screening_retry_delays_seconds",
            JSON,
            nullable=False,
            server_default=sa.text(f"'{DEFAULT_DELAYS}'::json"),
        ),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "screening_retry_delays_seconds")
