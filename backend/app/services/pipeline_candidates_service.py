"""Every candidate on a job, each in exactly one pipeline stage.

The stage pages (Resume screening, Phone screening, Interviews, Finalists, Rejected) each list
only the candidates currently in them, and the job's Candidates view shows all of them with the
stage each is in. Both must agree, so the stage is decided here, once, from the same inputs the
Phone and Interviews tabs use (`shortlist_stage_service`), not re-derived per screen.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import PaginationParams
from app.core.tenancy import get_tenant_job
from app.models.models import Candidate, ShortlistResult, User
from app.repositories.shortlist_repository import ShortlistRepository
from app.schemas.schemas import (
    PIPELINE_STAGES,
    PipelineCandidate,
    PipelineCandidatesResponse,
    ShortlistStage,
)
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


def summarize(
    rows: list[PipelineCandidate],
    *,
    stage: Optional[str],
    q: Optional[str],
    pagination: PaginationParams,
) -> PipelineCandidatesResponse:
    """Search, count per stage, filter by stage and page: the pure part of the listing.

    Counts cover the search results across all stages (so the stage chips say what each would
    show), while `total` and the page are for the chosen stage.
    """
    needle = (q or "").strip().lower()
    if needle:
        rows = [r for r in rows if needle in r.name.lower() or needle in (r.email or "").lower()]
    counts = {key: 0 for key in PIPELINE_STAGES}
    for r in rows:
        counts[r.stage] += 1
    chosen = [r for r in rows if stage is None or r.stage == stage]
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
        settings = None
        screening_effective = True
        if approved_ids:
            from app.services.screening_gate_service import is_voice_screening_effective
            from app.services.settings_service import load_system_settings

            settings = await load_system_settings(self._session, tenant_id=actor.tenant_id)
            screening_effective = is_voice_screening_effective(settings, job)

        rows: list[PipelineCandidate] = []
        for candidate in candidates:
            record = records.get(candidate.id)
            position: Optional[ShortlistStage] = None
            if record is not None and record.hr_decision == "approved":
                calls, sessions, has_report = stage_inputs.get(candidate.id, ([], [], False))
                position = resolve_shortlist_stage(
                    record.hr_decision,
                    calls,
                    sessions,
                    has_report=has_report,
                    finalist=record.finalist_at is not None,
                    phone=candidate.phone,
                    settings=settings,
                    screening_effective=screening_effective,
                )
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
                    failure_reason=(
                        summarize_processing_failure(candidate.pipeline_error)
                        if key == "failed"
                        else None
                    ),
                )
            )
        return summarize(rows, stage=stage, q=q, pagination=pagination)
