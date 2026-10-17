"""The observed-extensions catalog: what the Super Admin reviews.

Every flagged extension that is not already a known-list match is recorded once,
with how often and when it was seen. Nothing here refers to a candidate,
interview, job or organization.

Dismissal is a judgement about *that* extension as it looked then, so a
dismissed row reopens when something meaningful changes (see `observe`), and
never because it was merely seen again.
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import NotFoundError
from app.models.models import ObservedExtension, User
from app.repositories.observed_extension_repository import ObservedExtensionRepository
from app.schemas.integrity import (
    FlaggedExtensionIn,
    ObservedExtensionPage,
    ObservedExtensionResponse,
)
from app.services.audit_service import AuditService

logger = logging.getLogger(__name__)

#: Higher is stronger. A known-list match never reaches the catalog.
REASON_RANK = {"heuristic_weak": 1, "heuristic_strong": 2}
#: How many distinct content variants a row remembers (locales, renames).
MAX_KNOWN_HASHES = 25
_STORE_URL = "https://chromewebstore.google.com/detail/"
_CHROME_ID = re.compile(r"^[a-p]{32}$")


# ── pure helpers (unit tested without a database) ───────────────────────────


def content_hash(name: str, description: str | None) -> str:
    """Fingerprint of what an extension says about itself."""
    normal = lambda v: re.sub(r"\s+", " ", v or "").strip().lower()  # noqa: E731
    return hashlib.sha256(f"{normal(name)}\n{normal(description)}".encode("utf-8")).hexdigest()


def reason_rank(reason: str | None) -> int:
    return REASON_RANK.get(reason or "", 0)


def listing_url(extension_id: str) -> str | None:
    """Store link, only when the ID has the Chrome Web Store format."""
    return f"{_STORE_URL}{extension_id}" if _CHROME_ID.match(extension_id) else None


def observe(
    row: Any,
    *,
    name: str,
    description: str | None,
    reason: str,
    now: datetime,
) -> str | None:
    """Apply one sighting to a catalog row. Returns why it reopened, if it did.

    - Always: count and last-seen move; name/description refresh; strongest
      reason can only go up.
    - A sighting without a description (an older extension) is "no information",
      not "the description was removed": it keeps the stored one, so versions of
      the extension in the field cannot make a row flap.
    - A dismissed row reopens when the name+description is a variant it has never
      seen (an update or rename), or when the match got stronger than it was when
      dismissed. Seeing it again, however often, is not a reason.
    """
    effective_description = description if description is not None else row.description
    new_hash = content_hash(name, effective_description)

    row.times_seen = (row.times_seen or 0) + 1
    row.last_seen_at = now
    row.name = name
    row.description = effective_description
    if reason_rank(reason) > reason_rank(row.strongest_reason):
        row.strongest_reason = reason

    known = list(row.known_hashes or [])
    is_new_variant = new_hash not in known
    if is_new_variant:
        known.append(new_hash)
        row.known_hashes = known[-MAX_KNOWN_HASHES:]
    row.content_hash = new_hash

    if row.status != "dismissed":
        return None

    if is_new_variant:
        reopened = "content_changed"
    elif reason_rank(row.strongest_reason) > reason_rank(row.dismissed_reason):
        reopened = "stronger_match"
    else:
        return None

    row.status = "new"
    row.reopened_reason = reopened
    return reopened


def to_response(row: ObservedExtension) -> ObservedExtensionResponse:
    return ObservedExtensionResponse(
        id=row.id,
        extension_id=row.extension_id,
        name=row.name,
        description=row.description,
        strongest_reason=row.strongest_reason,
        times_seen=row.times_seen,
        first_seen_at=row.first_seen_at,
        last_seen_at=row.last_seen_at,
        status=row.status,  # type: ignore[arg-type]
        reopened_reason=row.reopened_reason,  # type: ignore[arg-type]
        listing_url=listing_url(row.extension_id),
    )


def _dedupe(items: Iterable[FlaggedExtensionIn]) -> dict[str, FlaggedExtensionIn]:
    """One item per extension id (the strongest), skipping known-list matches."""
    best: dict[str, FlaggedExtensionIn] = {}
    for item in items:
        if item.reason_code not in REASON_RANK:
            continue
        current = best.get(item.id)
        if current is None or reason_rank(item.reason_code) > reason_rank(current.reason_code):
            best[item.id] = item
    return best


# ── service ──────────────────────────────────────────────────────────────────


class ObservedExtensionService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        repo: ObservedExtensionRepository | None = None,
        audit: AuditService | None = None,
    ) -> None:
        self._session = session
        self._repo = repo or ObservedExtensionRepository(session)
        self._audit = audit or AuditService(session)

    async def record(self, flagged: Iterable[FlaggedExtensionIn]) -> None:
        """Fold one scan's flagged extensions into the catalog.

        Runs in the caller's transaction. Rows are created if missing, then
        locked in id order and updated, so concurrent scans neither lose counts
        nor deadlock.
        """
        items = _dedupe(flagged)
        if not items:
            return

        now = datetime.now(timezone.utc)
        await self._repo.ensure_rows(
            [
                {
                    "id": uuid.uuid4(),
                    "extension_id": ext_id,
                    "name": item.name,
                    "description": item.description,
                    "strongest_reason": item.reason_code,
                    "times_seen": 0,
                    "first_seen_at": now,
                    "last_seen_at": now,
                    "status": "new",
                    "content_hash": content_hash(item.name, item.description),
                    "known_hashes": [],
                }
                for ext_id, item in items.items()
            ]
        )
        for row in await self._repo.lock_many(list(items)):
            item = items[row.extension_id]
            observe(
                row,
                name=item.name,
                description=item.description,
                reason=item.reason_code,
                now=now,
            )

    # ── Super Admin ───────────────────────────────────────────────────────

    async def list_page(self, *, status: str, limit: int, offset: int) -> ObservedExtensionPage:
        rows, total = await self._repo.page(status=status, limit=limit, offset=offset)
        return ObservedExtensionPage(
            items=[to_response(r) for r in rows], total=total, limit=limit, offset=offset
        )

    async def dismiss(self, row_id: uuid.UUID, admin: User) -> ObservedExtensionResponse:
        row = await self._require(row_id)
        if row.status != "dismissed":
            row.status = "dismissed"
            row.dismissed_hash = row.content_hash
            row.dismissed_reason = row.strongest_reason
            row.dismissed_at = datetime.now(timezone.utc)
            row.dismissed_by_user_id = admin.id
            row.reopened_reason = None
            await self._log(admin, "extension_observed.dismissed", row)
        await self._session.commit()
        return to_response(row)

    async def restore(self, row_id: uuid.UUID, admin: User) -> ObservedExtensionResponse:
        row = await self._require(row_id)
        if row.status != "new":
            row.status = "new"
            row.dismissed_hash = None
            row.dismissed_reason = None
            row.dismissed_at = None
            row.dismissed_by_user_id = None
            row.reopened_reason = None
            await self._log(admin, "extension_observed.restored", row)
        await self._session.commit()
        return to_response(row)

    async def _require(self, row_id: uuid.UUID) -> ObservedExtension:
        row = await self._repo.get(row_id)
        if row is None:
            raise NotFoundError(public_message="Extension not found")
        return row

    async def _log(self, admin: User, action: str, row: ObservedExtension) -> None:
        await self._audit.log_change(
            actor=admin,
            action=action,
            entity_type="observed_extension",
            entity_id=row.id,
            subject_label=row.name,
            feature="platform",
            before=None,
            after={"extension_id": row.extension_id, "status": row.status},
        )
