"""rename_parse_status_to_pipeline_status

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-07-20

Replace parse_status/parse_started_at with pipeline_status/processing_started_at
for the direct upload → AI shortlist flow.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "x8y9z0a1b2c3"
down_revision: Union[str, None] = "w7x8y9z0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if _column_exists("candidates", "parse_status") and not _column_exists(
        "candidates", "pipeline_status"
    ):
        op.alter_column("candidates", "parse_status", new_column_name="pipeline_status")

    if _column_exists("candidates", "parse_started_at") and not _column_exists(
        "candidates", "processing_started_at"
    ):
        op.alter_column(
            "candidates", "parse_started_at", new_column_name="processing_started_at"
        )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            UPDATE candidates SET pipeline_status = 'completed'
            WHERE pipeline_status = 'ready'
            """
        )
        op.execute(
            """
            UPDATE candidates SET pipeline_status = 'failed'
            WHERE pipeline_status = 'parse_failed'
            """
        )
        op.execute(
            """
            UPDATE candidates SET pipeline_status = 'queued'
            WHERE pipeline_status IN ('pending_parse', 'parse_queued')
            """
        )
        op.execute(
            """
            UPDATE candidates SET pipeline_status = 'processing'
            WHERE pipeline_status IN ('parsing', 'parsed')
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" and _column_exists("candidates", "pipeline_status"):
        op.execute(
            """
            UPDATE candidates SET pipeline_status = 'ready'
            WHERE pipeline_status = 'completed'
            """
        )
        op.execute(
            """
            UPDATE candidates SET pipeline_status = 'parse_failed'
            WHERE pipeline_status = 'failed'
            """
        )
        op.execute(
            """
            UPDATE candidates SET pipeline_status = 'pending_parse'
            WHERE pipeline_status = 'queued'
            """
        )
        op.execute(
            """
            UPDATE candidates SET pipeline_status = 'parsing'
            WHERE pipeline_status = 'processing'
            """
        )

    if _column_exists("candidates", "processing_started_at") and not _column_exists(
        "candidates", "parse_started_at"
    ):
        op.alter_column(
            "candidates", "processing_started_at", new_column_name="parse_started_at"
        )

    if _column_exists("candidates", "pipeline_status") and not _column_exists(
        "candidates", "parse_status"
    ):
        op.alter_column("candidates", "pipeline_status", new_column_name="parse_status")
