"""add skip_ai_shortlist to candidates

Revision ID: x3y4z5a6b7c8
Revises: ab12cd34ef56
Create Date: 2026-07-31

Adds skip_ai_shortlist flag to candidates. Candidates created via the
talentOS integration are shortlisted/screened on the external platform,
so the POC's AI resume-review queue must never pick them up. Backfills
existing externally-created candidates and moves them out of the AI
review pipeline.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "x3y4z5a6b7c8"
down_revision: Union[str, None] = "ab12cd34ef56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _column_exists("candidates", "skip_ai_shortlist"):
        op.add_column(
            "candidates",
            sa.Column(
                "skip_ai_shortlist",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    op.execute(
        "UPDATE candidates SET skip_ai_shortlist = true "
        "WHERE external_candidate_id IS NOT NULL"
    )
    op.execute(
        "UPDATE candidates SET pipeline_status = 'completed' "
        "WHERE skip_ai_shortlist AND pipeline_status IN ('queued', 'processing')"
    )


def downgrade() -> None:
    if _column_exists("candidates", "skip_ai_shortlist"):
        op.drop_column("candidates", "skip_ai_shortlist")
