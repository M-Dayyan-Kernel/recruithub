"""add password_tokens

Revision ID: h4i5j6k7l8m9
Revises: g3h4i5j6k7l8
Create Date: 2026-10-12

One-time links for setting an organization admin's first password (emailed on
onboarding) and for self-service password reset. Only a hash of the token is
stored.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "h4i5j6k7l8m9"
down_revision: Union[str, None] = "g3h4i5j6k7l8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _table_exists("password_tokens"):
        return
    op.create_table(
        "password_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("purpose", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_password_tokens_user_id", "password_tokens", ["user_id"])
    op.create_index(
        "ix_password_tokens_token_hash", "password_tokens", ["token_hash"], unique=True
    )


def downgrade() -> None:
    if _table_exists("password_tokens"):
        op.drop_index("ix_password_tokens_token_hash", table_name="password_tokens")
        op.drop_index("ix_password_tokens_user_id", table_name="password_tokens")
        op.drop_table("password_tokens")
