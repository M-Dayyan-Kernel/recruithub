"""Every candidate on a job, each in exactly one pipeline stage.

The stage pages (Resume screening, Phone screening, Interviews, Finalists, Rejected) each list
only the candidates currently in them, and the job's Candidates view shows all of them with the
stage each is in. Both must agree, so the stage is decided here, once, from the same inputs the
Phone and Interviews tabs use (`shortlist_stage_service`), not re-derived per screen.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import PaginationParams
from app.core.tenancy import get_tenant_job
from app.models.models import Candidate, Job, ShortlistResult, User
from app.repositories.shortlist_repository import ShortlistRepository
from app.schemas.schemas import (
    PIPELINE_STAGES,
    PipelineCandidate,
    PipelineCandidatesResponse,
    PipelineSort,
    ShortlistStage,
)
from app.services.interview_pipeline_service import classify_interview_tab
from app.services.interview_round_service import latest_round
from app.services.processing_failure import summarize_processing_failure
from app.services.shortlist_stage_service import load_stages, resolve_shortlist_stage


def classify_pipeline_stage(
    candidate: Candidate,
    record: Optional[ShortlistResult],
    stage: Optional[ShortlistStage],
) -> str:
    """The one stage a candidate is in. `stage` is the approved candidate's resolved position."""
    manual = (candidate.status or "active").lower()
    if manual == "rejected":
        return "rejected"
    if manual == "hired":
        return "finalist"
    if candidate.pipeline_status == "failed":
        return "failed"
    if candidate.pipeline_status in ("queued", "processing"):
        return "processing"
    if record is None:
        # Finished processing but nothing scored: still being worked out, not a stage of its own.
        return "processing"
    if record.hr_decision == "rejected":
        return "rejected"
    if record.finalist_at is not None:
        return "finalist"
    if record.hr_decision != "approved":
        return "resume"
    if stage is None or stage.kind == "screening":
        return "phone"
    if stage.state == "finalist":
        return "finalist"
    # A passed call with no interview yet is still the phone stage's to act on.
    if stage.state == "pending":
        return "phone"
    return "interview"


def _name_of(candidate: Candidate) -> str:
    parsed = candidate.parsed_data or {}
    return parsed.get("name") or candidate.name or "Candidate"


def _email_of(candidate: Candidate) -> Optional[str]:
    raw = (candidate.parsed_data or {}).get("email") or candidate.email
    return None if not raw or str(raw).endswith("@upload.pending") else raw


def _position_of(
    record: Optional[ShortlistResult],
    candidate: Candidate,
    stage_inputs: dict,
    settings,
    screening_effective: bool,
) -> Optional[ShortlistStage]:
    """Where an approved candidate is in the pipeline; None for anyone not approved."""
    if record is None or record.hr_decision != "approved":
        return None
    calls, sessions, has_report = stage_inputs.get(candidate.id, ([], [], False))
    return resolve_shortlist_stage(
        record.hr_decision,
        calls,
        sessions,
        has_report=has_report,
        finalist=record.finalist_at is not None,
        phone=candidate.phone,
        settings=settings,
        screening_effective=screening_effective,
    )


async def _screening_context(session: AsyncSession, actor: User, job: Job, any_approved: bool):
    """The tenant settings and whether voice screening is on, needed only to place approved candidates."""
    if not any_approved:
        return None, True
    from app.services.screening_gate_service import is_voice_screening_effective
    from app.services.settings_service import load_system_settings

    settings = await load_system_settings(session, tenant_id=actor.tenant_id)
    return settings, is_voice_screening_effective(settings, job)


# The Phone screening tab a candidate in each call state is filed under (the page's own rule).
_PHONE_TAB = {"review": "completed", "failed": "completed", "pending": "completed", "flagged": "flagged"}


def landing_tab(
    stage: str, position: Optional[ShortlistStage], interview_tab: Optional[str]
) -> Optional[str]:
    """The tab of the stage page that lists a candidate, so a screen can open right on it."""
    if stage == "resume":
        return "results"
    if stage == "phone":
        state = position.state if position is not None else "queued"
        if state == "paused" and position is not None and position.reason:
            return "flagged"
        return _PHONE_TAB.get(state, "pending")
    if stage == "interview":
        # The Interviews page files "needs a link" under Scheduled.
        return "scheduled" if interview_tab in (None, "pending") else interview_tab
    return None


@dataclass
class Landing:
    stage: str
    tab: Optional[str]
    # The raw state inside the stage (a call or interview state), with its reason and time.
    position: Optional[ShortlistStage] = None


async def resolve_landing(
    session: AsyncSession, actor: User, job: Job, candidate: Candidate, record: Optional[ShortlistResult]
) -> Landing:
    """The stage a single candidate is in right now and the tab that lists them. Used after an
    action that moves someone (Reconsider) to say where they went."""
    inputs = await load_stages(session, job.id, [candidate.id] if record is not None and record.hr_decision == "approved" else [])
    settings, screening_effective = await _screening_context(
        session, actor, job, record is not None and record.hr_decision == "approved"
    )
    position = _position_of(record, candidate, inputs, settings, screening_effective)
    stage = classify_pipeline_stage(candidate, record, position)
    interview_tab = None
    if stage == "interview":
        _, sessions, has_report = inputs.get(candidate.id, ([], [], False))
        current = latest_round(sessions)
        interview_tab = classify_interview_tab(current, has_report=has_report) if current is not None else None
    return Landing(stage=stage, tab=landing_tab(stage, position, interview_tab), position=position)


def last_activity(candidate: Candidate, record: Optional[ShortlistResult], stage_inputs_for: tuple) -> datetime:
    """When something last happened to a candidate: a decision, rejection, call or interview round.
    Falls back to when they applied, so every candidate has one."""
    calls, sessions, _ = stage_inputs_for
    moments = [candidate.created_at]
    if record is not None:
        moments += [record.created_at, record.rejected_at, record.finalist_at]
    moments += [c.updated_at or c.created_at for c in calls]
    for session in sessions:
        moments += [session.created_at, session.started_at, session.completed_at]
    return max(m for m in moments if m is not None)


_SORTS = {
    # Highest first; candidates with no score sort last.
    "match": lambda r: (r.match_score is None, -(r.match_score or 0.0), r.name.lower()),
    "updated": lambda r: (-r.updated_at.timestamp(), r.name.lower()),
    "name": lambda r: (r.name.lower(),),
}


def summarize(
    rows: list[PipelineCandidate],
    *,
    stage: Optional[str],
    q: Optional[str],
    pagination: PaginationParams,
    sort: PipelineSort = "match",
) -> PipelineCandidatesResponse:
    """Search, count per stage, filter by stage, sort and page: the pure part of the listing.

    Counts cover the search results across all stages (so the stage chips say what each would
    show), while `total` and the page are for the chosen stage.
    """
    needle = (q or "").strip().lower()
    if needle:
        rows = [r for r in rows if needle in r.name.lower() or needle in (r.email or "").lower()]
    counts = {key: 0 for key in PIPELINE_STAGES}
    for r in rows:
        counts[r.stage] += 1
    chosen = sorted((r for r in rows if stage is None or r.stage == stage), key=_SORTS[sort])
    page = chosen[pagination.offset : pagination.offset + pagination.limit]
    return PipelineCandidatesResponse(
        items=page,
        total=len(chosen),
        counts=counts,
        limit=pagination.limit,
        offset=pagination.offset,
    )


class PipelineCandidatesService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._shortlist = ShortlistRepository(session)

    async def list(
        self,
        actor: User,
        job_id: uuid.UUID,
        *,
        stage: Optional[str],
        q: Optional[str],
        pagination: PaginationParams,
        sort: PipelineSort = "match",
    ) -> PipelineCandidatesResponse:
        job = await get_tenant_job(self._session, job_id, actor.tenant_id)

        candidates = list(
            (
                await self._session.execute(
                    select(Candidate)
                    .where(Candidate.job_id == job_id)
                    .order_by(Candidate.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        records = {r.candidate_id: r for r in await self._shortlist.list_for_job(job_id)}

        approved_ids = [cid for cid, r in records.items() if r.hr_decision == "approved"]
        stage_inputs = await load_stages(self._session, job_id, approved_ids)
        settings, screening_effective = await _screening_context(
            self._session, actor, job, bool(approved_ids)
        )

        rows: list[PipelineCandidate] = []
        for candidate in candidates:
            record = records.get(candidate.id)
            position = _position_of(record, candidate, stage_inputs, settings, screening_effective)
            key = classify_pipeline_stage(candidate, record, position)
            rows.append(
                PipelineCandidate(
                    candidate_id=candidate.id,
                    name=_name_of(candidate),
                    email=_email_of(candidate),
                    phone=candidate.phone,
                    stage=key,
                    state=position.state if position is not None else None,
                    reason=position.reason if position is not None else None,
                    scheduled_at=position.scheduled_at if position is not None else None,
                    match_score=record.match_score if record is not None else None,
                    recommendation=record.recommendation if record is not None else None,
                    hr_decision=record.hr_decision if record is not None else None,
                    applied_at=candidate.created_at,
                    updated_at=last_activity(candidate, record, stage_inputs.get(candidate.id, ([], [], False))),
                    failure_reason=(
                        summarize_processing_failure(candidate.pipeline_error)
                        if key == "failed"
                        else None
                    ),
                )
            )
        return summarize(rows, stage=stage, q=q, pagination=pagination, sort=sort)
