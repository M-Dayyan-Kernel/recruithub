"""extension check: organization master switch and the reason an interview was not checked

Revision ID: p2q3r4s5t6u7
Revises: o1p2q3r4s5t6
Create Date: 2026-10-30

Adds `extension_org_policy.extension_enabled`, the Admin's organization-wide switch for the AI
extension check. It starts on for every organization, so nothing changes until an Admin turns it
off. While it is off the check runs for no job, and recruiters cannot change a job's own switch.

Adds `interview_sessions.extension_check_disabled_by` ("org" or "job", null when the check ran or
for interviews that predate it), so a report can say who turned the check off.

Downgrade drops both columns; the Admin's choice and the recorded reasons are lost.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "p2q3r4s5t6u7"
down_revision: Union[str, None] = "o1p2q3r4s5t6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "extension_enabled" not in _columns("extension_org_policy"):
        op.add_column(
            "extension_org_policy",
            sa.Column("extension_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
    if "extension_check_disabled_by" not in _columns("interview_sessions"):
        op.add_column(
            "interview_sessions",
            sa.Column("extension_check_disabled_by", sa.String(10), nullable=True),
        )
        # Interviews already stamped as off were switched off on the job: no org switch existed.
        op.execute(
            "UPDATE interview_sessions SET extension_check_disabled_by = 'job' "
            "WHERE extension_check_enabled IS FALSE"
        )


def downgrade() -> None:
    if "extension_check_disabled_by" in _columns("interview_sessions"):
        op.drop_column("interview_sessions", "extension_check_disabled_by")
    if "extension_enabled" in _columns("extension_org_policy"):
        op.drop_column("extension_org_policy", "extension_enabled")
