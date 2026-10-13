"""unique organization names

Revision ID: i5j6k7l8m9n0
Revises: h4i5j6k7l8m9
Create Date: 2026-10-13

Two organizations could share a display name (only the slug was unique, and it
was silently suffixed "-2"). Adds a unique index on the case- and
whitespace-insensitive name, matching the check the services now run.

If duplicate names already exist the index cannot be built. The migration does
not guess which organization to rename: it logs the offenders, leaves the
schema alone, and the application-level check still blocks new duplicates.
Rename the organizations, then re-run the CREATE INDEX shown in the warning.
"""
from __future__ import annotations

import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "i5j6k7l8m9n0"
down_revision: Union[str, None] = "h4i5j6k7l8m9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

INDEX_NAME = "uq_tenants_name_normalized"
KEY_SQL = "lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))"


def _index_exists() -> bool:
    inspector = sa.inspect(op.get_bind())
    return INDEX_NAME in {ix["name"] for ix in inspector.get_indexes("tenants")}


def upgrade() -> None:
    if _index_exists():
        return
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text(
            f"SELECT {KEY_SQL} AS key, count(*) AS n, array_agg(name) AS names "
            f"FROM tenants GROUP BY 1 HAVING count(*) > 1"
        )
    ).fetchall()
    if duplicates:
        for row in duplicates:
            logger.warning(
                "Duplicate organization name %r used by %s organizations: %s",
                row.key,
                row.n,
                list(row.names),
            )
        logger.warning(
            "Skipping unique index %s until duplicates are renamed. Then run: "
            "CREATE UNIQUE INDEX %s ON tenants (%s)",
            INDEX_NAME,
            INDEX_NAME,
            KEY_SQL,
        )
        return
    op.execute(f"CREATE UNIQUE INDEX {INDEX_NAME} ON tenants ({KEY_SQL})")


def downgrade() -> None:
    if _index_exists():
        op.drop_index(INDEX_NAME, table_name="tenants")
