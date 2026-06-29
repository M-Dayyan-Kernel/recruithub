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


def upgrade() -> None:
    op.add_column('screening_calls', sa.Column('ended_reason', sa.String(), nullable=True))
    op.add_column('screening_calls', sa.Column('retry_count', sa.Integer(), server_default='0', nullable=False))
    op.add_column('screening_calls', sa.Column('call_outcome', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('screening_calls', 'call_outcome')
    op.drop_column('screening_calls', 'retry_count')
    op.drop_column('screening_calls', 'ended_reason')
