"""interview topic pool and per-interview plan items replace the fixed job questions

Revision ID: s5t6u7v8w9x0
Revises: r4s5t6u7v8w9
Create Date: 2026-10-31

A job no longer carries a fixed list of interview questions. It carries a pool of topics
(`job_interview_topics`); each interview draws some of them and gets its own plan
(`interview_plan_items`): the introduction, then the topics, each with the question to ask,
its expected points, and its share of the 100 points. `interview_sessions.plan_status` says
where that plan stands.

Drops `jobs.interview_questions` and the long-unused `jobs.interview_focus`; the questions are
not converted to topics (nothing was in production). Downgrade restores both columns empty and
drops the new tables.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "s5t6u7v8w9x0"
down_revision: Union[str, None] = "r4s5t6u7v8w9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if "job_interview_topics" not in tables:
        op.create_table(
            "job_interview_topics",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "job_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("jobs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("scope", sa.Text(), nullable=False),
            sa.Column("skill_tag", sa.String(60), nullable=False),
            sa.Column("seed_question", sa.Text(), nullable=False),
            sa.Column("seed_expected_points", sa.JSON(), nullable=True),
            sa.Column("is_mandatory", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_job_interview_topics_job_id", "job_interview_topics", ["job_id"])
    if "interview_plan_items" not in tables:
        op.create_table(
            "interview_plan_items",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "session_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("section", sa.String(16), nullable=False),
            sa.Column(
                "topic_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("job_interview_topics.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("topic_name", sa.String(120), nullable=True),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("expected_points", sa.JSON(), nullable=False),
            sa.Column("points", sa.Integer(), nullable=False),
        )
        op.create_index("ix_interview_plan_items_session_id", "interview_plan_items", ["session_id"])
        op.create_check_constraint(
            "ck_interview_plan_items_section",
            "interview_plan_items",
            "section IN ('intro', 'project', 'topic')",
        )

    sessions = _columns("interview_sessions")
    if "plan_status" not in sessions:
        op.add_column(
            "interview_sessions",
            sa.Column("plan_status", sa.String(16), nullable=False, server_default="pending"),
        )
    if "plan_generated_at" not in sessions:
        op.add_column(
            "interview_sessions", sa.Column("plan_generated_at", sa.DateTime(timezone=True), nullable=True)
        )

    jobs = _columns("jobs")
    for name in ("interview_questions", "interview_focus"):
        if name in jobs:
            op.drop_column("jobs", name)


def downgrade() -> None:
    jobs = _columns("jobs")
    if "interview_questions" not in jobs:
        op.add_column("jobs", sa.Column("interview_questions", sa.JSON(), nullable=True))
    if "interview_focus" not in jobs:
        op.add_column("jobs", sa.Column("interview_focus", postgresql.ARRAY(sa.String()), nullable=True))
    for name in ("plan_generated_at", "plan_status"):
        if name in _columns("interview_sessions"):
            op.drop_column("interview_sessions", name)
    tables = _tables()
    if "interview_plan_items" in tables:
        op.drop_table("interview_plan_items")
    if "job_interview_topics" in tables:
        op.drop_table("job_interview_topics")
