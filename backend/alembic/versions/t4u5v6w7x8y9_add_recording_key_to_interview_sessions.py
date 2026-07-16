"""add_recording_key_to_interview_sessions

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-07-16

Adds recording_key column to interview_sessions to store the S3 object key
for LiveKit egress recordings uploaded to Linode Object Storage.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "t4u5v6w7x8y9"
down_revision: Union[str, None] = "s3t4u5v6w7x8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _column_exists("interview_sessions", "recording_key"):
        op.add_column(
            "interview_sessions",
            sa.Column("recording_key", sa.String(length=512), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("interview_sessions", "recording_key"):
        op.drop_column("interview_sessions", "recording_key")
