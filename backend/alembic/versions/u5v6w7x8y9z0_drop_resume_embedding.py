"""drop_resume_embedding_and_promote_parsed

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-07-17

Promote candidates stuck in 'parsed' (post-parse, awaiting embedding) to 'ready',
and drop the unused resume_embedding pgvector column.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "u5v6w7x8y9z0"
down_revision: Union[str, None] = "t4u5v6w7x8y9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE candidates SET parse_status = 'ready' WHERE parse_status = 'parsed'"
        )
    )
    if _column_exists("candidates", "resume_embedding"):
        op.drop_column("candidates", "resume_embedding")


def downgrade() -> None:
    if not _column_exists("candidates", "resume_embedding"):
        # Requires the Postgres vector extension (left installed from initial schema).
        op.execute(sa.text("ALTER TABLE candidates ADD COLUMN resume_embedding vector(1536)"))
