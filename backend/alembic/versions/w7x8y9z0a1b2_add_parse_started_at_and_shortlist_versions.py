"""add_parse_started_at_and_shortlist_versions

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-07-20

- candidates.parse_started_at for accurate stuck-parse recovery
- shortlist_results.model_name / prompt_version for AI provenance
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "w7x8y9z0a1b2"
down_revision: Union[str, None] = "v6w7x8y9z0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _column_exists("candidates", "parse_started_at"):
        op.add_column(
            "candidates",
            sa.Column("parse_started_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _column_exists("shortlist_results", "model_name"):
        op.add_column(
            "shortlist_results",
            sa.Column("model_name", sa.String(length=100), nullable=True),
        )
    if not _column_exists("shortlist_results", "prompt_version"):
        op.add_column(
            "shortlist_results",
            sa.Column("prompt_version", sa.String(length=50), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("shortlist_results", "prompt_version"):
        op.drop_column("shortlist_results", "prompt_version")
    if _column_exists("shortlist_results", "model_name"):
        op.drop_column("shortlist_results", "model_name")
    if _column_exists("candidates", "parse_started_at"):
        op.drop_column("candidates", "parse_started_at")
