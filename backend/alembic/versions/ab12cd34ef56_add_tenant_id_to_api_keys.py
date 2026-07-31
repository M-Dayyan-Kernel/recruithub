"""add tenant_id to api_keys for tenant-scoped app keys

Revision ID: ab12cd34ef56
Revises: c5f66c977663
Create Date: 2026-07-31

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "ab12cd34ef56"
down_revision: Union[str, None] = "c5f66c977663"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "api_keys",
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_api_keys_tenant_id", "api_keys", ["tenant_id"], unique=False)
    op.create_foreign_key(
        "fk_api_keys_tenant_id_tenants",
        "api_keys",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_api_keys_tenant_id_tenants", "api_keys", type_="foreignkey")
    op.drop_index("ix_api_keys_tenant_id", table_name="api_keys")
    op.drop_column("api_keys", "tenant_id")
