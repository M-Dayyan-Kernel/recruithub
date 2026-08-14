"""add integration links/flow/event for one-click connect

Revision ID: c1d1e1f1a2b3
Revises: 5f6a7b8c9d0e
Create Date: 2026-08-14

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c1d1e1f1a2b3"
down_revision: Union[str, None] = "5f6a7b8c9d0e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "integration_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_tenant_id", sa.String(length=255), nullable=False),
        sa.Column(
            "state",
            sa.String(length=50),
            nullable=False,
            server_default=sa.text("'none'"),
        ),
        sa.Column("current_flow_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rhub_key_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("tal_key_id", sa.String(length=255), nullable=True),
        sa.Column("tal_key_enc", sa.Text(), nullable=True),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["rhub_key_id"],
            ["api_keys.id"],
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "provider", "tenant_id", name="uq_integration_link_provider_tenant"
        ),
    )
    op.create_index(
        "ix_integration_links_tenant_id",
        "integration_links",
        ["tenant_id"],
        unique=False,
    )
    op.create_index(
        "uq_integration_links_current_flow",
        "integration_links",
        ["current_flow_id"],
        unique=True,
        postgresql_where=sa.text("current_flow_id IS NOT NULL"),
    )

    op.create_table(
        "integration_link_flows",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("flow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("link_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operation", sa.String(length=20), nullable=False),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column(
            "attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(length=100), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "ping_a_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "ping_b_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["link_id"],
            ["integration_links.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_integration_link_flows_flow_id",
        "integration_link_flows",
        ["flow_id"],
        unique=True,
    )
    op.create_index(
        "ix_integration_link_flows_link_id",
        "integration_link_flows",
        ["link_id"],
        unique=False,
    )
    op.create_index(
        "ix_integration_link_flows_state_retry",
        "integration_link_flows",
        ["state", "next_retry_at"],
        unique=False,
    )

    op.create_table(
        "integration_link_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("link_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("flow_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=50), nullable=True),
        sa.Column("result", sa.String(length=20), nullable=True),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["link_id"],
            ["integration_links.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_integration_link_events_link_id",
        "integration_link_events",
        ["link_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_integration_link_events_link_id", table_name="integration_link_events")
    op.drop_table("integration_link_events")
    op.drop_index(
        "ix_integration_link_flows_state_retry", table_name="integration_link_flows"
    )
    op.drop_index("ix_integration_link_flows_link_id", table_name="integration_link_flows")
    op.drop_index("ix_integration_link_flows_flow_id", table_name="integration_link_flows")
    op.drop_table("integration_link_flows")
    op.drop_index("uq_integration_links_current_flow", table_name="integration_links")
    op.drop_index("ix_integration_links_tenant_id", table_name="integration_links")
    op.drop_table("integration_links")
