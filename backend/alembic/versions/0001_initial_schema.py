"""Initial schema — all 6 tables including pgvector

Revision ID: 0001
Revises:
Create Date: 2026-06-19

Tables created:
  - jobs
  - candidates             (includes resume_embedding vector(1536))
  - shortlist_results
  - screening_calls
  - interview_sessions
  - interview_reports
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import ARRAY, UUID

# revision identifiers
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Enable extensions ─────────────────────────────────────────────────────
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── jobs ──────────────────────────────────────────────────────────────────
    op.create_table(
        "jobs",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "required_skills",
            ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("experience_min", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("experience_max", sa.Integer(), nullable=True),
        sa.Column("screening_criteria", sa.Text(), nullable=True),
        sa.Column("interview_evaluation_criteria", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
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
    )
    op.create_index("ix_jobs_id", "jobs", ["id"])

    # ── candidates ────────────────────────────────────────────────────────────
    op.create_table(
        "candidates",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "job_id",
            UUID(as_uuid=True),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("resume_file_path", sa.String(512), nullable=True),
        sa.Column("resume_raw_text", sa.Text(), nullable=True),
        sa.Column("parsed_data", sa.JSON(), nullable=True),
        sa.Column(
            "parse_status",
            sa.String(30),
            nullable=False,
            server_default="pending_parse",
        ),
        # pgvector column — 1536 dimensions for text-embedding-3-small
        sa.Column("resume_embedding", Vector(1536), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_candidates_id", "candidates", ["id"])
    op.create_index("ix_candidates_job_id", "candidates", ["job_id"])
    op.create_index("ix_candidates_email", "candidates", ["email"])

    # ── shortlist_results ─────────────────────────────────────────────────────
    op.create_table(
        "shortlist_results",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "candidate_id",
            UUID(as_uuid=True),
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "job_id",
            UUID(as_uuid=True),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("match_score", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("recommendation", sa.String(20), nullable=False),
        sa.Column(
            "strengths", ARRAY(sa.String()), nullable=False, server_default="{}"
        ),
        sa.Column("gaps", ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "hr_decision", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column("hr_feedback_type", sa.String(40), nullable=True),
        sa.Column("hr_comments", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_shortlist_results_id", "shortlist_results", ["id"])
    op.create_index(
        "ix_shortlist_results_candidate_id", "shortlist_results", ["candidate_id"]
    )
    op.create_index("ix_shortlist_results_job_id", "shortlist_results", ["job_id"])

    # ── screening_calls ───────────────────────────────────────────────────────
    op.create_table(
        "screening_calls",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "candidate_id",
            UUID(as_uuid=True),
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "job_id",
            UUID(as_uuid=True),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("vapi_call_id", sa.String(255), nullable=True, unique=True),
        sa.Column(
            "call_status", sa.String(20), nullable=False, server_default="pending"
        ),
        sa.Column("availability", sa.Text(), nullable=True),
        sa.Column("employment_status", sa.String(100), nullable=True),
        sa.Column("relevant_experience", sa.Text(), nullable=True),
        sa.Column("current_ctc", sa.String(100), nullable=True),
        sa.Column("expected_ctc", sa.String(100), nullable=True),
        sa.Column("notice_period", sa.String(100), nullable=True),
        sa.Column("location_preference", sa.String(255), nullable=True),
        sa.Column("communication_quality", sa.Text(), nullable=True),
        sa.Column("willingness_to_proceed", sa.Boolean(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("result", sa.String(20), nullable=True),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_screening_calls_id", "screening_calls", ["id"])
    op.create_index(
        "ix_screening_calls_candidate_id", "screening_calls", ["candidate_id"]
    )
    op.create_index("ix_screening_calls_job_id", "screening_calls", ["job_id"])

    # ── interview_sessions ────────────────────────────────────────────────────
    op.create_table(
        "interview_sessions",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "candidate_id",
            UUID(as_uuid=True),
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "job_id",
            UUID(as_uuid=True),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("unique_token", sa.String(36), nullable=False, unique=True),
        sa.Column("livekit_room_name", sa.String(255), nullable=True, unique=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("email_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_interview_sessions_id", "interview_sessions", ["id"])
    op.create_index(
        "ix_interview_sessions_candidate_id", "interview_sessions", ["candidate_id"]
    )
    op.create_index(
        "ix_interview_sessions_job_id", "interview_sessions", ["job_id"]
    )
    op.create_index(
        "ix_interview_sessions_unique_token", "interview_sessions", ["unique_token"]
    )

    # ── interview_reports ─────────────────────────────────────────────────────
    op.create_table(
        "interview_reports",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "interview_session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "candidate_id",
            UUID(as_uuid=True),
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "job_id",
            UUID(as_uuid=True),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("transcript_summary", sa.Text(), nullable=True),
        sa.Column("technical_fit_score", sa.Float(), nullable=True),
        sa.Column("communication_score", sa.Float(), nullable=True),
        sa.Column("problem_solving_score", sa.Float(), nullable=True),
        sa.Column("experience_score", sa.Float(), nullable=True),
        sa.Column("role_alignment_score", sa.Float(), nullable=True),
        sa.Column("overall_score", sa.Float(), nullable=True),
        sa.Column(
            "strengths", ARRAY(sa.String()), nullable=False, server_default="{}"
        ),
        sa.Column(
            "weaknesses", ARRAY(sa.String()), nullable=False, server_default="{}"
        ),
        sa.Column("jd_fit", sa.Text(), nullable=True),
        sa.Column("final_recommendation", sa.Text(), nullable=True),
        sa.Column("raw_report", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_interview_reports_id", "interview_reports", ["id"])
    op.create_index(
        "ix_interview_reports_interview_session_id",
        "interview_reports",
        ["interview_session_id"],
    )
    op.create_index(
        "ix_interview_reports_candidate_id", "interview_reports", ["candidate_id"]
    )
    op.create_index("ix_interview_reports_job_id", "interview_reports", ["job_id"])


def downgrade() -> None:
    op.drop_table("interview_reports")
    op.drop_table("interview_sessions")
    op.drop_table("screening_calls")
    op.drop_table("shortlist_results")
    op.drop_table("candidates")
    op.drop_table("jobs")
    op.execute("DROP EXTENSION IF EXISTS vector")
    op.execute('DROP EXTENSION IF EXISTS "uuid-ossp"')
