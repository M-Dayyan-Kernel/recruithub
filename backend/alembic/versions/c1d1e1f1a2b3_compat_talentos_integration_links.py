"""compatibility revision for production DBs stamped on stich/talentos

Revision ID: c1d1e1f1a2b3
Revises: a2d9b9ebfc18
Create Date: 2026-09-01

Production databases deployed from the stich/talentos branch were upgraded
through a migration with this revision id (integration_links tables). That
revision is not part of the dev branch history. This no-op revision reconnects
those databases so `alembic upgrade head` succeeds on dev deploys.

If the integration_links* tables already exist (talentos deploy), upgrade is
a no-op. Fresh dev databases skip creating those tables — dev code does not
use them.
"""
from __future__ import annotations

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "c1d1e1f1a2b3"
down_revision: Union[str, None] = "a2d9b9ebfc18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
