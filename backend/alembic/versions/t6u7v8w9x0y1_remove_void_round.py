"""remove the void-round feature

Revision ID: t6u7v8w9x0y1
Revises: s5t6u7v8w9x0
Create Date: 2026-11-02

HR no longer voids a taken round to let a candidate retake it: a taken round stays on record and the
only way forward is the next round, scheduled by HR. Drops `interview_sessions.voided_at`,
`voided_by_user_id` and `void_reason`, and makes the round index plain: one session per
application and round number.

Nothing taken is lost. Sessions that were voided and had never been taken (a link that was cancelled
or lapsed and then replaced) are deleted: they have no report or recording. Every other session, a
voided taken round included, stays and the application's sessions are renumbered 1, 2, 3 by creation
order, so a voided round and its retake become two ordinary rounds.

Downgrade restores the three columns empty and the partial index; what was voided is not recoverable.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "t6u7v8w9x0y1"
down_revision: Union[str, None] = "s5t6u7v8w9x0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX = "uq_interview_sessions_round_per_application"


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _columns("interview_sessions")
    # First, so the renumbering below cannot trip over it half way through.
    op.execute(f"DROP INDEX IF EXISTS {_INDEX}")

    if "voided_at" in columns:
        op.execute(
            """
            DELETE FROM interview_sessions s
            WHERE s.voided_at IS NOT NULL
              AND s.status IN ('pending', 'expired', 'cancelled')
              AND NOT EXISTS (SELECT 1 FROM interview_reports r WHERE r.interview_session_id = s.id)
            """
        )
    op.execute(
        """
        UPDATE interview_sessions s SET round_number = n.rn
        FROM (
            SELECT id, row_number() OVER (
                PARTITION BY candidate_id, job_id ORDER BY created_at, id
            ) AS rn
            FROM interview_sessions
        ) n
        WHERE s.id = n.id AND s.round_number IS DISTINCT FROM n.rn
        """
    )
    op.execute(f"CREATE UNIQUE INDEX {_INDEX} ON interview_sessions (candidate_id, job_id, round_number)")

    for name in ("void_reason", "voided_by_user_id", "voided_at"):
        if name in columns:
            op.drop_column("interview_sessions", name)


def downgrade() -> None:
    columns = _columns("interview_sessions")
    op.execute(f"DROP INDEX IF EXISTS {_INDEX}")
    if "voided_at" not in columns:
        op.add_column("interview_sessions", sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True))
    if "voided_by_user_id" not in columns:
        op.add_column(
            "interview_sessions",
            sa.Column(
                "voided_by_user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    if "void_reason" not in columns:
        op.add_column("interview_sessions", sa.Column("void_reason", sa.Text(), nullable=True))
    op.execute(
        f"CREATE UNIQUE INDEX {_INDEX} ON interview_sessions (candidate_id, job_id, round_number) "
        "WHERE voided_at IS NULL"
    )
