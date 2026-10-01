"""add multi-tenant tables and tenant_id columns

Revision ID: p0q1r2s3t4u5
Revises: o9p0q1r2s3t4
Create Date: 2026-07-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "p0q1r2s3t4u5"
down_revision: Union[str, Sequence[str], None] = "o9p0q1r2s3t4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001"


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_tenants_slug", "tenants", ["slug"], unique=False)

    op.execute(
        sa.text(
            f"""
            INSERT INTO tenants (id, name, slug)
            VALUES ('{DEFAULT_TENANT_ID}'::uuid, 'Default Organization', 'default')
            """
        )
    )

    op.create_table(
        "tenant_invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("invited_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_tenant_invites_tenant_id", "tenant_invites", ["tenant_id"], unique=False)
    op.create_index("ix_tenant_invites_email", "tenant_invites", ["email"], unique=False)
    op.create_index("ix_tenant_invites_token", "tenant_invites", ["token"], unique=False)

    op.add_column("users", sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(sa.text(f"UPDATE users SET tenant_id = '{DEFAULT_TENANT_ID}'::uuid WHERE tenant_id IS NULL"))
    op.alter_column("users", "tenant_id", nullable=False)
    op.create_index("ix_users_tenant_id", "users", ["tenant_id"], unique=False)
    op.create_foreign_key(
        "fk_users_tenant_id_tenants", "users", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE"
    )

    op.add_column("jobs", sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(sa.text(f"UPDATE jobs SET tenant_id = '{DEFAULT_TENANT_ID}'::uuid WHERE tenant_id IS NULL"))
    op.alter_column("jobs", "tenant_id", nullable=False)
    op.create_index("ix_jobs_tenant_id", "jobs", ["tenant_id"], unique=False)
    op.create_foreign_key(
        "fk_jobs_tenant_id_tenants", "jobs", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE"
    )

    op.add_column("system_settings", sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        sa.text(
            f"UPDATE system_settings SET tenant_id = '{DEFAULT_TENANT_ID}'::uuid WHERE tenant_id IS NULL"
        )
    )
    # Ensure a settings row exists for the default tenant
    op.execute(
        sa.text(
            f"""
            INSERT INTO system_settings (
                tenant_id, allowed_phone_regions, enforce_phone_geography,
                screening_enabled, screening_max_retries, screening_retry_delay_seconds, company_name
            )
            SELECT
                '{DEFAULT_TENANT_ID}'::uuid, '["IN"]'::json, true, true, 3, 1800, 'Webknot Technologies'
            WHERE NOT EXISTS (
                SELECT 1 FROM system_settings WHERE tenant_id = '{DEFAULT_TENANT_ID}'::uuid
            )
            """
        )
    )
    op.alter_column("system_settings", "tenant_id", nullable=False)
    op.create_index("ix_system_settings_tenant_id", "system_settings", ["tenant_id"], unique=True)
    op.create_foreign_key(
        "fk_system_settings_tenant_id_tenants",
        "system_settings",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.add_column("audit_logs", sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(sa.text(f"UPDATE audit_logs SET tenant_id = '{DEFAULT_TENANT_ID}'::uuid"))
    op.create_index("ix_audit_logs_tenant_id", "audit_logs", ["tenant_id"], unique=False)
    op.create_foreign_key(
        "fk_audit_logs_tenant_id_tenants",
        "audit_logs",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_audit_logs_tenant_id_tenants", "audit_logs", type_="foreignkey")
    op.drop_index("ix_audit_logs_tenant_id", table_name="audit_logs")
    op.drop_column("audit_logs", "tenant_id")

    op.drop_constraint("fk_system_settings_tenant_id_tenants", "system_settings", type_="foreignkey")
    op.drop_index("ix_system_settings_tenant_id", table_name="system_settings")
    op.drop_column("system_settings", "tenant_id")

    op.drop_constraint("fk_jobs_tenant_id_tenants", "jobs", type_="foreignkey")
    op.drop_index("ix_jobs_tenant_id", table_name="jobs")
    op.drop_column("jobs", "tenant_id")

    op.drop_constraint("fk_users_tenant_id_tenants", "users", type_="foreignkey")
    op.drop_index("ix_users_tenant_id", table_name="users")
    op.drop_column("users", "tenant_id")

    op.drop_index("ix_tenant_invites_token", table_name="tenant_invites")
    op.drop_index("ix_tenant_invites_email", table_name="tenant_invites")
    op.drop_index("ix_tenant_invites_tenant_id", table_name="tenant_invites")
    op.drop_table("tenant_invites")

    op.drop_index("ix_tenants_slug", table_name="tenants")
    op.drop_table("tenants")
