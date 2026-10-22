"""Backfill the time onto old `interview.rescheduled` audit rows.

Reschedules used to audit only the new session id. The time lives on the new
`interview_sessions` row, so this copies it (and the previous session's time)
into the audit row. Rows that already carry `scheduled_interview_at` are
skipped, so it is safe to re-run.

    python -m scripts.backfill_reschedule_audit            # dry run, from backend/
    python -m scripts.backfill_reschedule_audit --apply    # write
"""

from __future__ import annotations

import argparse
import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm.attributes import flag_modified

from app.core.config_loader import config
from app.models.models import AuditLog, InterviewSession


def _iso(value):
    return value.isoformat() if value else None


async def run(apply: bool) -> None:
    engine = create_async_engine(config.DATABASE_URL)
    async with async_sessionmaker(engine, class_=AsyncSession)() as db:
        rows = (
            await db.execute(select(AuditLog).where(AuditLog.action == "interview.rescheduled"))
        ).scalars().all()
        updated = skipped = unmatched = with_time = 0
        for row in rows:
            after = dict(row.after_state or {})
            if "scheduled_interview_at" in after:
                skipped += 1
                continue
            try:
                session_id = uuid.UUID(str(after.get("session_id")))
            except ValueError:
                unmatched += 1
                continue
            new = await db.get(InterviewSession, session_id)
            if not new:
                unmatched += 1
                continue
            previous = (
                await db.get(InterviewSession, new.rescheduled_from_session_id)
                if new.rescheduled_from_session_id
                else None
            )
            after["scheduled_interview_at"] = _iso(new.scheduled_interview_at)
            row.after_state = after
            row.before_state = {"scheduled_interview_at": _iso(previous.scheduled_interview_at) if previous else None}
            flag_modified(row, "after_state")
            flag_modified(row, "before_state")
            updated += 1
            with_time += 1 if new.scheduled_interview_at else 0
        print(f"rows={len(rows)} updated={updated} (with a time: {with_time}) already_done={skipped} unmatched={unmatched}")
        if apply:
            await db.commit()
            print("applied")
        else:
            await db.rollback()
            print("dry run — nothing written (use --apply)")
    await engine.dispose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    asyncio.run(run(ap.parse_args().apply))
