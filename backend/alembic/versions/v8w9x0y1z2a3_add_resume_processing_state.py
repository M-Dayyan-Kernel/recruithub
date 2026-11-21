"""add resume processing state to candidates

Revision ID: v8w9x0y1z2a3
Revises: u7v8w9x0y1z2
Create Date: 2026-11-21

A resume used to have only `pipeline_status` and `processing_started_at`, which could not tell a
row waiting between retries from a stuck one, could not cap attempts across recovery, and could
not tell a stale duplicate task from the live one. Adds:

- `processing_attempts`: attempts since upload or the last manual retry (the global cap).
- `processing_retry_at`: when the next automatic retry is due; null when none is waiting.
- `processing_token`: the dispatched task's token; any other token is stale.
- `pipeline_status_at`: when `pipeline_status` last changed, for the elapsed time HR sees.

Existing rows start at zero attempts with nothing pending. `pipeline_status_at` stays null for
them and the client falls back to `created_at`.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "v8w9x0y1z2a3"
down_revision: Union[str, None] = "u7v8w9x0y1z2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column("processing_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "candidates",
        sa.Column("processing_retry_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("candidates", sa.Column("processing_token", sa.String(32), nullable=True))
    op.add_column(
        "candidates",
        sa.Column("pipeline_status_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("candidates", "pipeline_status_at")
    op.drop_column("candidates", "processing_token")
    op.drop_column("candidates", "processing_retry_at")
    op.drop_column("candidates", "processing_attempts")
