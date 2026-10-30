"""extension check: drop the organization-wide defaults

Revision ID: o1p2q3r4s5t6
Revises: n0o1p2q3r4s5
Create Date: 2026-10-30

An organization no longer has defaults for the extension check. A job's switch and mode are set
on the job itself (a new job starts on, in shadow mode), and look-alike detection is always on.
The three columns that held those settings are dropped from `extension_org_policy`.

The policy version is bumped for every organization: orgs that had look-alike detection off now
send the full rules, and a changed version is how a report shows which rules an interview ran under.

Downgrade re-adds the columns with their old defaults; any values an organization had set are lost.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "o1p2q3r4s5t6"
down_revision: Union[str, None] = "n0o1p2q3r4s5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("default_enabled", "default_mode", "heuristics_enabled")


def _columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("extension_org_policy")}


def upgrade() -> None:
    present = _columns()
    op.execute("UPDATE extension_org_policy SET version = version + 1")
    for name in _COLUMNS:
        if name in present:
            op.drop_column("extension_org_policy", name)


def downgrade() -> None:
    present = _columns()
    if "default_enabled" not in present:
        op.add_column(
            "extension_org_policy",
            sa.Column("default_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
    if "default_mode" not in present:
        op.add_column(
            "extension_org_policy",
            sa.Column("default_mode", sa.String(10), nullable=False, server_default="shadow"),
        )
    if "heuristics_enabled" not in present:
        op.add_column(
            "extension_org_policy",
            sa.Column("heuristics_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
