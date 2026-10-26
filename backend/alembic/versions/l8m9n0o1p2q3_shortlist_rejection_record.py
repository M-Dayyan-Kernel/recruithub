"""shortlist rejection record

Where a candidate was rejected from, by whom and when, whether they have been told, and
what Reconsider restores. Additive: `hr_decision = 'rejected'` stays the marker, so code
that does not know these columns keeps working. Existing rejections are classified by
`scripts/backfill_rejections.py` (dry run by default), not here.

The profile status "on_hold" is retired: it was a label nothing acted on.

Revision ID: l8m9n0o1p2q3
Revises: k7l8m9n0o1p2
Create Date: 2026-10-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "l8m9n0o1p2q3"
down_revision: Union[str, None] = "k7l8m9n0o1p2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("shortlist_results", sa.Column("rejected_from", sa.String(20), nullable=True))
    op.add_column("shortlist_results", sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "shortlist_results",
        sa.Column("rejected_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("shortlist_results", sa.Column("rejection_email_claimed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("shortlist_results", sa.Column("rejection_emailed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("shortlist_results", sa.Column("reconsider_state", sa.String(30), nullable=True))
    op.execute("UPDATE candidates SET status = 'active' WHERE status = 'on_hold'")


def downgrade() -> None:
    # Lossy: the record of where each rejection came from and whether the candidate was
    # told is dropped, and `on_hold` is not restored. Rows stay rejected.
    for column in (
        "reconsider_state",
        "rejection_emailed_at",
        "rejection_email_claimed_at",
        "rejected_by",
        "rejected_at",
        "rejected_from",
    ):
        op.drop_column("shortlist_results", column)
