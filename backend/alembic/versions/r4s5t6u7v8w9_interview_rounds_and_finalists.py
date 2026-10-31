"""interview rounds, voided rounds, and the application-level finalist mark

Revision ID: r4s5t6u7v8w9
Revises: q3r4s5t6u7v8
Create Date: 2026-10-31

An application (a candidate on a job) can now have up to `interview.max_rounds` interview
rounds. Each round is one interview session:

- `interview_sessions.round_number` numbers them 1, 2, 3.
- `voided_at`, `voided_by_user_id` and `void_reason` mark a round HR voided so the candidate can
  retake it; the voided session keeps its report, and the retake reuses the round number.
- A partial unique index allows one live (not voided) session per application and round.

The decision moves off the session: `shortlist_results.finalist_at` and `finalist_by_user_id`
say the application was marked a finalist, and `interview_sessions.hr_decision` is dropped.
Rejecting was already recorded on the shortlist row. Sessions that were approved become
finalists. `shortlist_results` also gets the (job_id, candidate_id) uniqueness the code already
assumes.

`rescheduled_from_session_id` is dropped: a reschedule now moves the same session instead of
creating a successor. Sessions that had been superseded by a reschedule are voided so the
round index holds, and the rest are numbered by creation order.

Downgrade restores both dropped columns (approved again for finalists; the reschedule links
are not recoverable) and drops the rest.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "r4s5t6u7v8w9"
down_revision: Union[str, None] = "q3r4s5t6u7v8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    sessions = _columns("interview_sessions")
    if "round_number" not in sessions:
        op.add_column(
            "interview_sessions",
            sa.Column("round_number", sa.Integer(), nullable=False, server_default="1"),
        )
    if "voided_at" not in sessions:
        op.add_column("interview_sessions", sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True))
    if "voided_by_user_id" not in sessions:
        op.add_column(
            "interview_sessions",
            sa.Column(
                "voided_by_user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    if "void_reason" not in sessions:
        op.add_column("interview_sessions", sa.Column("void_reason", sa.Text(), nullable=True))

    shortlist = _columns("shortlist_results")
    if "finalist_at" not in shortlist:
        op.add_column("shortlist_results", sa.Column("finalist_at", sa.DateTime(timezone=True), nullable=True))
    if "finalist_by_user_id" not in shortlist:
        op.add_column(
            "shortlist_results",
            sa.Column(
                "finalist_by_user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )

    if "hr_decision" in sessions:
        op.execute(
            """
            UPDATE shortlist_results sr SET finalist_at = now()
            FROM interview_sessions s
            WHERE s.candidate_id = sr.candidate_id AND s.job_id = sr.job_id
              AND s.hr_decision = 'approved' AND sr.hr_decision <> 'rejected'
            """
        )
    if "rescheduled_from_session_id" in sessions:
        op.execute(
            """
            UPDATE interview_sessions SET voided_at = now(),
                void_reason = 'Rescheduled before interview rounds existed'
            WHERE id IN (
                SELECT rescheduled_from_session_id FROM interview_sessions
                WHERE rescheduled_from_session_id IS NOT NULL
            )
            """
        )
    op.execute(
        """
        UPDATE interview_sessions s SET round_number = n.rn
        FROM (
            SELECT id, row_number() OVER (
                PARTITION BY candidate_id, job_id ORDER BY created_at, id
            ) AS rn
            FROM interview_sessions WHERE voided_at IS NULL
        ) n
        WHERE s.id = n.id
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_sessions_round_per_application
        ON interview_sessions (candidate_id, job_id, round_number)
        WHERE voided_at IS NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_shortlist_results_job_candidate
        ON shortlist_results (job_id, candidate_id)
        """
    )

    if "hr_decision" in sessions:
        op.drop_column("interview_sessions", "hr_decision")
    if "rescheduled_from_session_id" in sessions:
        op.drop_column("interview_sessions", "rescheduled_from_session_id")


def downgrade() -> None:
    sessions = _columns("interview_sessions")
    if "hr_decision" not in sessions:
        op.add_column(
            "interview_sessions",
            sa.Column("hr_decision", sa.String(20), nullable=False, server_default="pending"),
        )
    if "rescheduled_from_session_id" not in sessions:
        op.add_column(
            "interview_sessions",
            sa.Column(
                "rescheduled_from_session_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("interview_sessions.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    op.execute(
        """
        UPDATE interview_sessions s SET hr_decision = 'approved'
        FROM shortlist_results sr
        WHERE sr.candidate_id = s.candidate_id AND sr.job_id = s.job_id
          AND sr.finalist_at IS NOT NULL AND s.voided_at IS NULL
          AND s.round_number = (
              SELECT max(round_number) FROM interview_sessions
              WHERE candidate_id = s.candidate_id AND job_id = s.job_id AND voided_at IS NULL
          )
        """
    )
    op.execute("DROP INDEX IF EXISTS uq_shortlist_results_job_candidate")
    op.execute("DROP INDEX IF EXISTS uq_interview_sessions_round_per_application")
    for name in ("finalist_by_user_id", "finalist_at"):
        op.drop_column("shortlist_results", name)
    for name in ("void_reason", "voided_by_user_id", "voided_at", "round_number"):
        op.drop_column("interview_sessions", name)
