"""add video proctoring columns to interview_sessions

Revision ID: g3h4i5j6k7l8
Revises: f2a4b6c8d0e2
Create Date: 2026-09-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "g3h4i5j6k7l8"
down_revision: Union[str, None] = "f2a4b6c8d0e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "interview_sessions",
        sa.Column("video_proctoring_job_id", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "interview_sessions",
        sa.Column("video_proctoring_status", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "interview_sessions",
        sa.Column("video_proctoring_result", sa.JSON(), nullable=True),
    )
    op.add_column(
        "interview_sessions",
        sa.Column("video_proctoring_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("interview_sessions", "video_proctoring_error")
    op.drop_column("interview_sessions", "video_proctoring_result")
    op.drop_column("interview_sessions", "video_proctoring_status")
    op.drop_column("interview_sessions", "video_proctoring_job_id")
