"""add transcript_segments and recording_ready to interview_sessions

Revision ID: z1a2b3c4d5e6
Revises: y0z1a2b3c4d5
Create Date: 2026-07-22

Adds transcript_segments JSON for turn-level timed transcript playback
and recording_ready flag set when LiveKit egress completes.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "z1a2b3c4d5e6"
down_revision: Union[str, None] = "y0z1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _column_exists("interview_sessions", "transcript_segments"):
        op.add_column(
            "interview_sessions",
            sa.Column("transcript_segments", sa.JSON(), nullable=True),
        )
    if not _column_exists("interview_sessions", "recording_ready"):
        op.add_column(
            "interview_sessions",
            sa.Column("recording_ready", sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("interview_sessions", "recording_ready"):
        op.drop_column("interview_sessions", "recording_ready")
    if _column_exists("interview_sessions", "transcript_segments"):
        op.drop_column("interview_sessions", "transcript_segments")
