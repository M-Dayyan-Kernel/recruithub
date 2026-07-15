"""add tenant verification fields for org signup approval

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-07-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "s3t4u5v6w7x8"
down_revision: Union[str, Sequence[str], None] = "r2s3t4u5v6w7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "verification_status",
            sa.String(length=20),
            server_default="approved",
            nullable=False,
        ),
    )
    op.add_column(
        "tenants",
        sa.Column("company_registration_number", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("gst_document_path", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("gst_document_filename", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tenants", "gst_document_filename")
    op.drop_column("tenants", "gst_document_path")
    op.drop_column("tenants", "company_registration_number")
    op.drop_column("tenants", "verification_status")
