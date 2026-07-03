"""add screening call window to jobs and system_settings table

Revision ID: a1b2c3d4e5f6
Revises: e7a3d1f2b6c8
Create Date: 2026-07-02

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "e7a3d1f2b6c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("screening_call_from", sa.Time(), nullable=True, server_default=sa.text("'09:00:00'")),
    )
    op.add_column(
        "jobs",
        sa.Column("screening_call_to", sa.Time(), nullable=True, server_default=sa.text("'18:00:00'")),
    )
    op.add_column(
        "jobs",
        sa.Column(
            "screening_timezone",
            sa.String(64),
            nullable=False,
            server_default="Asia/Kolkata",
        ),
    )

    op.create_table(
        "system_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "allowed_phone_regions",
            JSON,
            nullable=False,
            server_default=sa.text("'[\"IN\"]'::json"),
        ),
        sa.Column(
            "enforce_phone_geography",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.execute(
        "INSERT INTO system_settings (id, allowed_phone_regions, enforce_phone_geography) "
        "VALUES (1, '[\"IN\"]'::json, true)"
    )


def downgrade() -> None:
    op.drop_table("system_settings")
    op.drop_column("jobs", "screening_timezone")
    op.drop_column("jobs", "screening_call_to")
    op.drop_column("jobs", "screening_call_from")
