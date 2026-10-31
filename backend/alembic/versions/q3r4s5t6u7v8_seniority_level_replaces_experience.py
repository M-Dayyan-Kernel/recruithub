"""jobs: seniority_level replaces experience_min / experience_max

Revision ID: q3r4s5t6u7v8
Revises: p2q3r4s5t6u7
Create Date: 2026-10-31

Adds `jobs.seniority_level` (intern | junior | mid | senior), backfilled from the years the job
carried using the thresholds the interview prompts used before: a maximum of 2 or less is junior,
a minimum of 5 or more (or a maximum above 5) is senior, a minimum of 1 or 2 is junior, the rest
is mid. Then drops `experience_min` and `experience_max`.

Downgrade restores the two columns with representative years for each level (the original values
are not recoverable) and drops `seniority_level`.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "q3r4s5t6u7v8"
down_revision: Union[str, None] = "p2q3r4s5t6u7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEVELS = ("intern", "junior", "mid", "senior")


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    cols = _columns("jobs")
    if "seniority_level" not in cols:
        op.add_column(
            "jobs",
            sa.Column("seniority_level", sa.String(16), nullable=False, server_default="mid"),
        )
        op.create_check_constraint(
            "ck_jobs_seniority_level",
            "jobs",
            "seniority_level IN ('intern', 'junior', 'mid', 'senior')",
        )
    if "experience_min" in cols and "experience_max" in cols:
        op.execute(
            """
            UPDATE jobs SET seniority_level = CASE
                WHEN experience_max > 0 AND experience_max <= 2 THEN 'junior'
                WHEN experience_min >= 5 OR experience_max > 5 THEN 'senior'
                WHEN experience_min BETWEEN 1 AND 2 THEN 'junior'
                ELSE 'mid'
            END
            """
        )
    for name in ("experience_min", "experience_max"):
        if name in cols:
            op.drop_column("jobs", name)


def downgrade() -> None:
    cols = _columns("jobs")
    if "experience_min" not in cols:
        op.add_column("jobs", sa.Column("experience_min", sa.Integer(), nullable=False, server_default="0"))
    if "experience_max" not in cols:
        op.add_column("jobs", sa.Column("experience_max", sa.Integer(), nullable=False, server_default="0"))
    op.execute(
        """
        UPDATE jobs SET experience_min = CASE seniority_level
                WHEN 'intern' THEN 0 WHEN 'junior' THEN 1 WHEN 'mid' THEN 3 ELSE 5 END,
            experience_max = CASE seniority_level
                WHEN 'intern' THEN 1 WHEN 'junior' THEN 2 WHEN 'mid' THEN 5 ELSE 0 END
        """
    )
    if "seniority_level" in cols:
        op.drop_constraint("ck_jobs_seniority_level", "jobs", type_="check")
        op.drop_column("jobs", "seniority_level")
