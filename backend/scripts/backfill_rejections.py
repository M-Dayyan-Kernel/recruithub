"""Move existing rejections into the Rejected stage's record.

    python -m scripts.backfill_rejections                  # dry run: prints what would change
    python -m scripts.backfill_rejections --apply          # writes it
    python -m scripts.backfill_rejections --tenant <uuid>  # one tenant only

Idempotent: a row that already has its rejection record, or is no longer in the state
described, is not touched again. Run the dry run first and read it: the audit log is the
only source for where a rejection came from and who made it, and it can be missing.

What it does, per candidate on a job:

  A. Already rejected (hr_decision = rejected, no record): origin from the newest audit row
     (screening.rejected -> phone, shortlist.decision_set -> resume). Those were emailed at
     reject time, so they are marked emailed; failures were never recorded, so this is an
     assumption. No audit row: origin is taken as resume and they are NOT marked emailed;
     they are listed as "unknown origin".
  B. Interview rejected (shortlist approved, latest interview decision rejected): moved to
     rejected from interview, not told yet.
  Dates for B and C come from the audit log when it has the event, otherwise from the
  call's or interview's own timestamps (best effort, not exact). With --apply each row is
  locked and re-read, and anyone on a call or in an interview right now is left alone.

  C. Phone rejected by the call result (approved, no interview, latest real call result
     "fail"): moved to rejected from phone, not told yet. Reconsider returns them to "needs
     review" rather than redialling.

Listed, not moved (they need a person): a failed call result that already has an interview
session, and a profile status of "rejected" on someone who is not rejected on the shortlist.
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config_loader import config
from app.core.screening_skipped import is_skipped_call
from app.models.models import (
    AuditLog,
    Candidate,
    InterviewSession,
    Job,
    ScreeningCall,
    ShortlistResult,
)
from app.services.live_work_guard import interview_is_live
from app.services.screening_trigger_service import call_is_on_its_way
from app.services.shortlist_stage_service import is_successful_call


@dataclass
class Report:
    moved: dict[str, list[str]] = field(default_factory=lambda: {"A": [], "B": [], "C": []})
    unknown_origin: list[str] = field(default_factory=list)
    not_moved: list[str] = field(default_factory=list)

    def lines(self, applied: bool) -> list[str]:
        verb = "moved" if applied else "would move"
        out = [
            f"A. already rejected, record added : {len(self.moved['A'])}",
            f"B. interview rejected, {verb}      : {len(self.moved['B'])}",
            f"C. phone fail, {verb}              : {len(self.moved['C'])}",
            f"   of A, unknown origin (no audit) : {len(self.unknown_origin)}",
            f"listed, not moved                  : {len(self.not_moved)}",
        ]
        for title, items in (
            ("A", self.moved["A"]),
            ("B", self.moved["B"]),
            ("C", self.moved["C"]),
            ("unknown origin (taken as resume, not marked emailed)", self.unknown_origin),
            ("not moved, needs a person", self.not_moved),
        ):
            if items:
                out.append(f"\n{title}:")
                out.extend(f"  - {item}" for item in items)
        return out


async def _newest_audit(db: AsyncSession, job_id, candidate_id, actions: tuple[str, ...]) -> AuditLog | None:
    return (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.job_id == job_id, AuditLog.candidate_id == candidate_id, AuditLog.action.in_(actions))
            .order_by(AuditLog.created_at.desc())
            .limit(1)
        )
    ).scalars().first()


async def _lock_and_check(db: AsyncSession, row: ShortlistResult, expected: str, calls, sessions) -> str | None:
    """With --apply, take the row (and re-read it) so a decision made meanwhile is not
    overwritten, and leave anyone who is live alone. Returns why to skip, or None."""
    await db.refresh(row, with_for_update=True)
    if row.hr_decision != expected or row.rejected_from is not None and expected != "rejected":
        return f"changed meanwhile (now {row.hr_decision})"
    for c in calls:
        await db.refresh(c, with_for_update=True)
    for s_ in sessions:
        await db.refresh(s_, with_for_update=True)
    if any(call_is_on_its_way(c) for c in calls) or any(interview_is_live(s_) for s_ in sessions):
        return "on a call or in an interview right now"
    return None


def _label(candidate: Candidate | None, job: Job) -> str:
    return f"{(candidate.name if candidate else '?')} · {job.title}"


async def run(db: AsyncSession, *, apply: bool, tenant_id: uuid.UUID | None = None) -> Report:
    report = Report()
    query = select(ShortlistResult, Job).join(Job, Job.id == ShortlistResult.job_id)
    if tenant_id is not None:
        query = query.where(Job.tenant_id == tenant_id)
    for row, job in (await db.execute(query)).all():
        candidate = await db.get(Candidate, row.candidate_id)
        label = _label(candidate, job)
        calls = list(
            (
                await db.execute(
                    select(ScreeningCall)
                    .where(ScreeningCall.job_id == row.job_id, ScreeningCall.candidate_id == row.candidate_id)
                    .order_by(ScreeningCall.created_at.desc())
                )
            ).scalars().all()
        )
        sessions = list(
            (
                await db.execute(
                    select(InterviewSession)
                    .where(InterviewSession.job_id == row.job_id, InterviewSession.candidate_id == row.candidate_id)
                    .order_by(InterviewSession.created_at.desc())
                )
            ).scalars().all()
        )
        latest_session = sessions[0] if sessions else None
        real_reached = [c for c in calls if is_successful_call(c) and not is_skipped_call(c)]

        if row.hr_decision == "rejected" and row.rejected_from is None:
            audit = await _newest_audit(db, row.job_id, row.candidate_id, ("screening.rejected", "shortlist.decision_set"))
            origin = None
            if audit is not None:
                if audit.action == "screening.rejected":
                    origin = "phone"
                elif (audit.after_state or {}).get("hr_decision") == "rejected":
                    origin = "resume"
            if origin is None:
                report.unknown_origin.append(label)
                origin, rejected_at, actor, emailed = "resume", row.created_at, None, None
            else:
                rejected_at, actor, emailed = audit.created_at, audit.actor_user_id, audit.created_at
            report.moved["A"].append(f"{label} ({origin})")
            if apply:
                row.rejected_from, row.rejected_at, row.rejected_by = origin, rejected_at, actor
                row.rejection_emailed_at = emailed
            continue

        if row.hr_decision == "approved" and latest_session is not None and latest_session.hr_decision == "rejected":
            audit = await _newest_audit(db, row.job_id, row.candidate_id, ("interview.decision_set",))
            if audit is not None and (audit.after_state or {}).get("hr_decision") == "rejected":
                rejected_at, actor = audit.created_at, audit.actor_user_id
            else:
                # InterviewSession has no updated_at: the closest honest date is when it ended.
                rejected_at, actor = latest_session.completed_at or latest_session.created_at, None
            if apply and (why := await _lock_and_check(db, row, "approved", calls, sessions)):
                report.not_moved.append(f"{label}: {why}")
                continue
            report.moved["B"].append(label)
            if apply:
                row.hr_decision = "rejected"
                row.rejected_from, row.rejected_at, row.rejected_by = "interview", rejected_at, actor
                row.reconsider_state = "interview"
            continue

        if row.hr_decision == "approved" and real_reached and real_reached[0].result == "fail":
            if latest_session is not None:
                report.not_moved.append(f"{label}: call result is fail but they have an interview")
                continue
            call = real_reached[0]
            audit = await _newest_audit(db, row.job_id, row.candidate_id, ("screening.result_set",))
            if audit is not None and audit.entity_id == call.id and (audit.after_state or {}).get("result") == "fail":
                rejected_at, actor = audit.created_at, audit.actor_user_id
            else:
                rejected_at, actor = call.created_at, None
            if apply and (why := await _lock_and_check(db, row, "approved", calls, sessions)):
                report.not_moved.append(f"{label}: {why}")
                continue
            report.moved["C"].append(label)
            if apply:
                row.hr_decision = "rejected"
                row.rejected_from, row.rejected_at, row.rejected_by = "phone", rejected_at, actor
                row.reconsider_state = "phone_failed"
            continue

        if candidate is not None and (candidate.status or "").lower() == "rejected" and row.hr_decision != "rejected":
            report.not_moved.append(f"{label}: profile status is rejected, shortlist is {row.hr_decision}")

    if apply:
        await db.commit()
    return report


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    parser.add_argument("--tenant", type=uuid.UUID, default=None)
    args = parser.parse_args()

    engine = create_async_engine(config.DATABASE_URL)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as db:
        report = await run(db, apply=args.apply, tenant_id=args.tenant)
    print("APPLIED" if args.apply else "DRY RUN (nothing written; add --apply)")
    print("\n".join(report.lines(args.apply)))
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
