"""replace per-retry delays with max retries and constant delay

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-02

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column(
            "screening_max_retries",
            sa.Integer(),
            nullable=False,
            server_default="3",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "screening_retry_delay_seconds",
            sa.Integer(),
            nullable=False,
            server_default="1800",
        ),
    )

    # Migrate first delay from legacy JSON array; keep max retries at 3
    op.execute(
        """
        UPDATE system_settings
        SET screening_retry_delay_seconds = COALESCE(
            (screening_retry_delays_seconds->>0)::integer,
            1800
        )
        WHERE screening_retry_delays_seconds IS NOT NULL
        """
    )

    op.drop_column("system_settings", "screening_retry_delays_seconds")


def downgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column(
            "screening_retry_delays_seconds",
            sa.dialects.postgresql.JSON(),
            nullable=False,
            server_default=sa.text("'[1800, 7200, 86400]'::json"),
        ),
    )
    op.execute(
        """
        UPDATE system_settings
        SET screening_retry_delays_seconds = json_build_array(
            screening_retry_delay_seconds,
            screening_retry_delay_seconds * 4,
            screening_retry_delay_seconds * 48
        )
        """
    )
    op.drop_column("system_settings", "screening_retry_delay_seconds")
    op.drop_column("system_settings", "screening_max_retries")
