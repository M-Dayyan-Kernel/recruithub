"""add call outcome fields to screening_calls

Revision ID: e7a3d1f2b6c8
Revises: d4f1a2b3c5e6
Create Date: 2026-06-23

Adds:
- ended_reason   (String, nullable)   — raw Vapi endedReason value
- retry_count    (Integer, not null)  — how many times this call has been retried
- call_outcome   (String, nullable)   — classified outcome label
  values: "completed" | "no_answer" | "voicemail" | "declined" | "dropped" | "failed"
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e7a3d1f2b6c8'
down_revision = 'd4f1a2b3c5e6'
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
  bind = op.get_bind()
  inspector = sa.inspect(bind)
  return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
  if not _column_exists('screening_calls', 'ended_reason'):
    op.add_column('screening_calls', sa.Column('ended_reason', sa.String(), nullable=True))
  if not _column_exists('screening_calls', 'retry_count'):
    op.add_column('screening_calls', sa.Column('retry_count', sa.Integer(), server_default='0', nullable=False))
  if not _column_exists('screening_calls', 'call_outcome'):
    op.add_column('screening_calls', sa.Column('call_outcome', sa.String(), nullable=True))


def downgrade() -> None:
  if _column_exists('screening_calls', 'call_outcome'):
    op.drop_column('screening_calls', 'call_outcome')
  if _column_exists('screening_calls', 'retry_count'):
    op.drop_column('screening_calls', 'retry_count')
  if _column_exists('screening_calls', 'ended_reason'):
    op.drop_column('screening_calls', 'ended_reason')
