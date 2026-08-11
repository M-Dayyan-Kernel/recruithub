"""Fire-and-forget webhook pushes that mirror AI interview status into talentOS.

The POC classifies each session via ``classify_interview_tab()`` and pushes the
resulting pipeline status to talentOS BE, which applies it blindly (full sync):

    scheduled -> INTERVIEW_SCHEDULED
    ongoing   -> ONGOING
    completed -> UNDER_EVALUATION
    flagged   -> NO_SHOW (with a human-readable reason)

Pushes are best-effort: a failure is logged and left for the talentOS pull
sweep to converge on.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import InterviewSession, Job
from app.modules.talentos_integration.talentos_be_client import (
    get_talentos_client_for_tenant,
)
from app.services.interview_flag_service import get_flag_reason
from app.services.interview_pipeline_service import classify_interview_tab

logger = logging.getLogger(__name__)

TALENTOS_STATUS_BY_TAB = {
    "scheduled": "INTERVIEW_SCHEDULED",
    "ongoing": "ONGOING",
    "completed": "UNDER_EVALUATION",
    "flagged": "NO_SHOW",
    "finalists": "UNDER_EVALUATION",
}


def _serialize_session(session: InterviewSession) -> dict:
    def _iso(dt):
        return dt.isoformat() if dt is not None else None

    return {
        "id": str(session.id),
        "status": session.status,
        "hr_decision": getattr(session, "hr_decision", None),
        "interview_url": getattr(session, "interview_url", None),
        "created_at": _iso(getattr(session, "created_at", None)),
        "started_at": _iso(getattr(session, "started_at", None)),
        "completed_at": _iso(getattr(session, "completed_at", None)),
        "expires_at": _iso(getattr(session, "expires_at", None)),
        "transcript": session.transcript,
    }


async def sync_interview_status_to_talentos(
    db: AsyncSession,
    session: InterviewSession,
    *,
    has_report: bool = False,
) -> None:
    """Best-effort push of a session's current pipeline status to talentOS.

    Only the candidate's latest session is pushed — superseded sessions (e.g.
    one expired by a reschedule) must never regress the candidate's status.
    """
    try:
        job: Job | None = await db.get(Job, session.job_id) if session.job_id else None
        external_job_id = getattr(job, "external_job_id", None) if job else None
        if not external_job_id:
            return

        latest_result = await db.execute(
            select(InterviewSession.id)
            .where(
                InterviewSession.candidate_id == session.candidate_id,
                InterviewSession.job_id == session.job_id,
            )
            .order_by(InterviewSession.created_at.desc())
            .limit(1)
        )
        if latest_result.scalars().first() != session.id:
            logger.info(
                "sync_interview_status skipped: session=%s is not the candidate's latest session",
                session.id,
            )
            return

        tab = classify_interview_tab(session, has_report=has_report)
        status = TALENTOS_STATUS_BY_TAB.get(tab)
        if not status:
            logger.info("sync_interview_status skipped: unclassified tab=%s session=%s", tab, session.id)
            return

        flag_reason = get_flag_reason(session, has_report=has_report)
        result = _serialize_session(session)
        result["talentos_status"] = status

        client = await get_talentos_client_for_tenant(job.tenant_id if job else None)
        await client.push_interview_completion(
            external_job_id=str(external_job_id),
            external_candidate_id=str(session.candidate_id),
            interview_id=str(session.id),
            result=result,
            status=status,
            flag_reason=flag_reason,
        )
    except Exception as exc:
        logger.warning(
            "sync_interview_status_to_talentos failed (session=%s): %s",
            getattr(session, "id", None),
            exc,
        )
