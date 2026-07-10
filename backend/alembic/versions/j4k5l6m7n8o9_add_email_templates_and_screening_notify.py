"""add email templates and screening failed-attempt notification fields

Revision ID: j4k5l6m7n8o9
Revises: i3j4k5l6m7n8
Create Date: 2026-07-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "j4k5l6m7n8o9"
down_revision: Union[str, None] = "i3j4k5l6m7n8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column("email_templates", postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "screening_calls",
        sa.Column("failed_attempt_email_sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "screening_calls",
        sa.Column(
            "failed_attempt_email_status",
            sa.String(50),
            nullable=True,
        ),
    )
    op.add_column(
        "interview_sessions",
        sa.Column(
            "rescheduled_from_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("interview_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("interview_sessions", "rescheduled_from_session_id")
    op.drop_column("screening_calls", "failed_attempt_email_status")
    op.drop_column("screening_calls", "failed_attempt_email_sent_at")
    op.drop_column("system_settings", "email_templates")
