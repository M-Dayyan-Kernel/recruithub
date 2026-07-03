"""
Screening Tasks — Sprint 5

Celery tasks for AI voice screening via Vapi.ai.

Tasks:
  - initiate_screening_call: load DB records, call Vapi, update ScreeningCall status
  - process_screening_webhook: extract transcript from Vapi payload, run GPT-4o extraction,
    update ScreeningCall with structured fields + pass/fail/needs_review result

Pattern: sync Celery wrapper → asyncio.run() → async inner function
DB sessions: get_celery_db() (NullPool) — mandatory for Celery on Windows event loop
"""

import asyncio
import json
import logging
import uuid

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.database import get_celery_db

logger = logging.getLogger(__name__)

SCREENING_SYNC_INITIAL_DELAY_SEC = 0
SCREENING_SYNC_POLL_INTERVAL_SEC = 2
SCREENING_SYNC_MAX_POLLS = 60
VAPI_STATUS_TIMEOUT_SEC = 4.0
MIN_LIVE_CALL_GRACE_SECONDS = 12
MIN_RETRY_CALL_GRACE_SECONDS = 20

LIVE_CALL_STATUSES = ("initiated", "in_progress")


# ---------------------------------------------------------------------------
# Task 5.6a — Initiate outbound Vapi screening call
# ---------------------------------------------------------------------------

@celery_app.task(name="tasks.initiate_screening_call", bind=True, max_retries=3)
def initiate_screening_call(self, screening_call_id: str):
    """
    Celery task: initiate a Vapi.ai outbound call for a ScreeningCall record.

    Enqueued by POST /api/jobs/{job_id}/screening/trigger.
    On success: updates vapi_call_id + call_status="initiated"
    On failure: sets call_status="failed"
    """
    try:
        asyncio.run(_async_initiate(self, screening_call_id))
    except Exception as exc:
        logger.error("initiate_screening_call failed for %s: %s", screening_call_id, exc)
        raise


async def _async_initiate(task_self, screening_call_id: str) -> None:
    """Async inner: loads ScreeningCall + Candidate + Job, calls Vapi."""
    from app.models.models import ScreeningCall, Candidate, Job
    from app.services.vapi_service import initiate_screening_call as vapi_initiate

    async with get_celery_db() as session:
        # Load ScreeningCall
        result = await session.execute(
            select(ScreeningCall).where(ScreeningCall.id == uuid.UUID(screening_call_id))
        )
        screening_call = result.scalars().first()
        if not screening_call:
            logger.error("ScreeningCall %s not found — aborting (no retry)", screening_call_id)
            return

        if screening_call.vapi_call_id or screening_call.call_status != "pending":
            logger.info(
                "ScreeningCall %s already dispatched (status=%s) — skipping duplicate initiate",
                screening_call_id,
                screening_call.call_status,
            )
            return

        from app.models.models import ScreeningCall as ScreeningCallModel

        other_live = await session.execute(
            select(ScreeningCallModel.id).where(
                ScreeningCallModel.job_id == screening_call.job_id,
                ScreeningCallModel.candidate_id == screening_call.candidate_id,
                ScreeningCallModel.id != screening_call.id,
                ScreeningCallModel.call_status.in_(LIVE_CALL_STATUSES),
            )
        )
        if other_live.scalar_one_or_none():
            logger.info(
                "Candidate %s already has a live screening call — deferring %s",
                screening_call.candidate_id,
                screening_call_id,
            )
            initiate_screening_call.apply_async(args=[screening_call_id], countdown=15)
            return

        # Load Candidate
        candidate_result = await session.execute(
            select(Candidate).where(Candidate.id == screening_call.candidate_id)
        )
        candidate = candidate_result.scalars().first()
        if not candidate:
            logger.error(
                "Candidate %s not found for screening call %s — aborting",
                screening_call.candidate_id,
                screening_call_id,
            )
            screening_call.call_status = "failed"
            await session.commit()
            return

        # Load Job
        job_result = await session.execute(
            select(Job).where(Job.id == screening_call.job_id)
        )
        job = job_result.scalars().first()
        if not job:
            logger.error(
                "Job %s not found for screening call %s — aborting",
                screening_call.job_id,
                screening_call_id,
            )
            screening_call.call_status = "failed"
            await session.commit()
            return

        from app.services.call_window_service import (
            is_within_call_window,
            seconds_until_next_window,
        )

        if not is_within_call_window(job):
            countdown = seconds_until_next_window(job)
            logger.info(
                "ScreeningCall %s outside call window — rescheduling in %ds",
                screening_call_id,
                countdown,
            )
            initiate_screening_call.apply_async(
                args=[screening_call_id],
                countdown=countdown,
            )
            return

        # Call Vapi
        try:
            vapi_call_id = await vapi_initiate(
                candidate=candidate,
                job=job,
                screening_call_id=screening_call.id,
            )
            screening_call.vapi_call_id = vapi_call_id
            screening_call.call_status = "initiated"
            await session.commit()
            logger.info(
                "Screening call initiated: screening_call_id=%s vapi_call_id=%s",
                screening_call_id,
                vapi_call_id,
            )
            sync_screening_call_status.apply_async(
                args=[screening_call_id],
                countdown=SCREENING_SYNC_INITIAL_DELAY_SEC,
            )

        except Exception as exc:
            logger.error(
                "Vapi initiation failed for screening_call %s: %s", screening_call_id, exc
            )
            screening_call.call_status = "failed"
            screening_call.call_outcome = "failed"
            screening_call.summary = str(exc)[:500]
            await session.commit()
            # Retry on transient errors — don't retry if it looks like a config/auth issue
            err_str = str(exc).lower()
            if (
                "401" in err_str
                or "403" in err_str
                or "api key" in err_str
                or "transport" in err_str
                or "validation" in err_str
            ):
                logger.error("Config/auth error — not retrying: %s", exc)
                return
            raise task_self.retry(exc=exc, countdown=120)


# ---------------------------------------------------------------------------
# Task 5.6c — Poll Vapi for call status (fallback when webhooks unavailable)
# ---------------------------------------------------------------------------

@celery_app.task(name="tasks.sync_screening_call_status", bind=True, max_retries=0)
def sync_screening_call_status(self, screening_call_id: str, poll_attempt: int = 0):
    """
    Poll Vapi for call progress and update ScreeningCall status.

    Scheduled after initiate_screening_call. Re-schedules while the call is active.
    When Vapi reports the call ended, enqueues process_screening_webhook.
    """
    try:
        asyncio.run(_async_sync_status(screening_call_id, poll_attempt))
    except Exception as exc:
        logger.error("sync_screening_call_status failed for %s: %s", screening_call_id, exc)


async def _async_sync_status(screening_call_id: str, poll_attempt: int) -> None:
    from app.models.models import ScreeningCall

    async with get_celery_db() as session:
        result = await session.execute(
            select(ScreeningCall).where(ScreeningCall.id == uuid.UUID(screening_call_id))
        )
        screening_call = result.scalars().first()
        if not screening_call or not screening_call.vapi_call_id:
            return
        if screening_call.call_status in ("completed", "failed"):
            return

        finalized = await _finalize_screening_call_from_vapi(session, screening_call, force=False)
        if finalized:
            return

        if poll_attempt < SCREENING_SYNC_MAX_POLLS:
            sync_screening_call_status.apply_async(
                args=[screening_call_id, poll_attempt + 1],
                countdown=SCREENING_SYNC_POLL_INTERVAL_SEC,
            )
            return

        logger.warning(
            "sync_screening_call_status: max polls reached for %s — force finalizing",
            screening_call_id,
        )
        await _finalize_screening_call_from_vapi(session, screening_call, force=True)


def _parse_vapi_call_payload(vapi_call: dict) -> tuple[str, str | None, str | None, str, str | None]:
    from app.services.vapi_service import map_vapi_status_to_call_status

    vapi_status = (vapi_call.get("status") or "").lower()
    mapped = map_vapi_status_to_call_status(vapi_call.get("status"))
    ended_reason = vapi_call.get("endedReason") or vapi_call.get("ended_reason")
    ended_at = vapi_call.get("endedAt") or vapi_call.get("ended_at")
    artifact = vapi_call.get("artifact") or {}
    transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""
    return vapi_status, mapped, ended_reason, transcript, ended_at


def _call_age_seconds(screening_call) -> float:
    from datetime import datetime, timezone

    created = screening_call.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - created).total_seconds()


def _min_finalize_grace_seconds(screening_call) -> int:
    if (screening_call.retry_count or 0) > 0:
        return MIN_RETRY_CALL_GRACE_SECONDS
    return MIN_LIVE_CALL_GRACE_SECONDS


def _can_finalize_live_call(vapi_call: dict, screening_call, *, force: bool) -> bool:
    """Block premature finalization while the phone may still be ringing."""
    from app.services.vapi_service import is_vapi_call_ended

    if force:
        return True
    if not is_vapi_call_ended(vapi_call):
        return False

    age_sec = _call_age_seconds(screening_call)
    grace = _min_finalize_grace_seconds(screening_call)
    vapi_status = (vapi_call.get("status") or "").lower().replace("_", "-")
    artifact = vapi_call.get("artifact") or {}
    transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""

    # Carrier-level failures — on retries, ignore instant busy/no-answer (rapid redial).
    if vapi_status in ("busy", "no-answer", "failed"):
        if (screening_call.retry_count or 0) > 0 and age_sec < 8:
            return False
        return True

    if transcript.strip():
        return True

    started_at = vapi_call.get("startedAt") or vapi_call.get("started_at")
    if started_at and age_sec < grace:
        return False

    if age_sec < grace:
        return False

    return True


def _infer_ended_reason(
    vapi_status: str,
    mapped: str | None,
    ended_reason: str | None,
    *,
    started_at: str | None = None,
    has_transcript: bool = False,
) -> str:
    if ended_reason:
        return ended_reason
    if vapi_status == "busy":
        return "customer-busy"
    if vapi_status == "no-answer":
        return "customer-did-not-answer"
    if mapped == "failed":
        return vapi_status or "call-failed"
    if started_at or has_transcript:
        return "customer-ended-call"
    return "customer-did-not-answer"


async def _finalize_screening_call_from_vapi(
    session,
    screening_call,
    *,
    force: bool = False,
) -> bool:
    """Poll Vapi once and finalize the screening call when the dial has ended."""
    from app.services.vapi_service import get_vapi_call

    if screening_call.call_status in ("completed", "failed"):
        return False
    if not screening_call.vapi_call_id:
        return False

    vapi_call: dict | None = None
    try:
        vapi_call = await get_vapi_call(
            screening_call.vapi_call_id,
            timeout=VAPI_STATUS_TIMEOUT_SEC,
        )
    except Exception as exc:
        if not force:
            logger.warning(
                "Could not fetch Vapi call %s: %s",
                screening_call.vapi_call_id,
                exc,
            )
            return False
        logger.warning(
            "Force-finalizing screening call %s after Vapi fetch failure: %s",
            screening_call.id,
            exc,
        )
        await apply_screening_call_end(
            session,
            screening_call,
            ended_reason="customer-did-not-answer",
            transcript="",
        )
        return True

    vapi_status, mapped, ended_reason, transcript, _ended_at = _parse_vapi_call_payload(
        vapi_call
    )
    started_at = vapi_call.get("startedAt") or vapi_call.get("started_at")

    if mapped in LIVE_CALL_STATUSES and mapped != screening_call.call_status:
        screening_call.call_status = mapped
        await session.flush()

    if not _can_finalize_live_call(vapi_call, screening_call, force=force):
        return False

    resolved_reason = _infer_ended_reason(
        vapi_status,
        mapped,
        ended_reason,
        started_at=started_at,
        has_transcript=bool(transcript.strip()),
    )

    finalized = await apply_screening_call_end(
        session,
        screening_call,
        ended_reason=resolved_reason,
        transcript=transcript,
    )
    if finalized and transcript.strip() and vapi_call is not None:
        artifact = vapi_call.get("artifact") or {}
        payload = {
            "call": vapi_call,
            "artifact": artifact,
            "endedReason": resolved_reason,
        }
        process_screening_webhook.delay(payload)
    return finalized


async def refresh_live_screening_calls_from_vapi(session, screening_calls) -> bool:
    """Eagerly poll Vapi for in-flight calls. Returns True if any call was finalized."""
    import asyncio

    live_calls = [
        call
        for call in screening_calls
        if call.call_status in LIVE_CALL_STATUSES and call.vapi_call_id
    ]
    if not live_calls:
        return False

    results = await asyncio.gather(
        *[
            _finalize_screening_call_from_vapi(session, call, force=False)
            for call in live_calls
        ],
        return_exceptions=True,
    )
    any_updated = any(r is True for r in results)
    for result in results:
        if isinstance(result, Exception):
            logger.warning("Live screening refresh failed: %s", result)
    return any_updated


async def refresh_screening_call_from_vapi(session, screening_call) -> bool:
    """Poll Vapi for a single screening call and finalize if ended."""
    return await _finalize_screening_call_from_vapi(session, screening_call, force=False)


def describe_screening_failure(ended_reason: str | None) -> str:
    """Return a user-facing summary for technical call failures."""
    if not ended_reason:
        return (
            "The call could not be connected. Check Vapi phone number and Twilio provider settings."
        )

    reason = ended_reason.lower()
    if "error-get-transport" in reason:
        return (
            "Could not start the phone call (Vapi transport error). "
            "Verify in Vapi that your phone number has Twilio connected, enable India (+91) "
            "in Twilio Geo Permissions, and ensure the Twilio account can place outbound calls "
            "(trial accounts often block international dialing)."
        )
    if "error-get-resources-validation" in reason:
        return (
            "Call setup failed validation in Vapi. Check assistant voice/model settings "
            "and that VAPI_PHONE_NUMBER_ID matches an active number in your Vapi dashboard."
        )
    if "transport" in reason or "provider" in reason:
        return (
            f"Telephony provider error ({ended_reason}). "
            "Check Twilio credentials and outbound calling permissions in Vapi."
        )

    return (
        f"Call failed before connecting ({ended_reason}). "
        "Check Vapi/Twilio configuration and the candidate phone number in E.164 format."
    )


def _extract_vapi_end_fields(payload: dict) -> tuple[str | None, str, str | None]:
    """Return (vapi_call_id, transcript, ended_reason) from a Vapi webhook or GET /call payload."""
    message = payload.get("message") or {}
    call_data = payload.get("call") or message.get("call") or {}
    artifact = (
        payload.get("artifact")
        or message.get("artifact")
        or call_data.get("artifact")
        or {}
    )
    vapi_call_id = call_data.get("id")
    transcript = artifact.get("transcript") or artifact.get("transcriptText", "") or ""
    ended_reason = (
        payload.get("endedReason")
        or message.get("endedReason")
        or call_data.get("endedReason")
        or None
    )
    return vapi_call_id, transcript, ended_reason


async def apply_screening_call_end(
    session,
    screening_call,
    *,
    ended_reason: str | None,
    transcript: str = "",
    schedule_retry: bool = True,
) -> bool:
    """
    Immediately mark a ScreeningCall as finished (no GPT).

    Returns True if the call was finalized, False if already terminal.
    """
    if screening_call.call_status in ("completed", "failed"):
        return False

    transcript_length = len((transcript or "").strip())
    outcome, should_retry = classify_call_outcome(ended_reason, transcript_length)

    screening_call.ended_reason = ended_reason
    screening_call.call_outcome = outcome
    if transcript:
        screening_call.transcript = transcript

    if outcome == "failed":
        screening_call.call_status = "failed"
        screening_call.result = None
        screening_call.summary = describe_screening_failure(ended_reason)
        await session.commit()
        return True

    screening_call.call_status = "completed"
    if outcome in ("no_answer", "voicemail"):
        screening_call.result = "needs_review"
        screening_call.summary = (
            f"Call ended with reason: {ended_reason or 'unknown'}. "
            f"Outcome: {outcome}. No transcript available."
        )
    elif outcome == "dropped":
        screening_call.result = "needs_review"
        screening_call.summary = (
            "Candidate hung up before the screening could be completed. "
            "You can retry the call."
        )
    elif not transcript:
        screening_call.result = "needs_review"
        screening_call.summary = (
            f"Call ended with reason: {ended_reason or 'unknown'}. "
            f"Outcome: {outcome}. No transcript available."
        )

    if schedule_retry and should_retry and not transcript.strip():
        from app.services.settings_service import can_schedule_retry, get_system_settings

        settings = await get_system_settings()
        if can_schedule_retry(screening_call.retry_count, settings.screening_max_retries):
            await _schedule_retry(session, screening_call)

    await session.commit()
    return True


def classify_call_outcome(ended_reason: str | None, transcript_length: int) -> tuple[str, bool]:
    """
    Returns (outcome_label, should_retry).

    outcome_label: "completed" | "no_answer" | "voicemail" | "declined" | "dropped" | "failed"
    should_retry: True if we should auto-schedule a retry call
    """
    if not ended_reason:
        return ("completed", False) if transcript_length > 0 else ("no_answer", True)

    r = ended_reason.lower()

    assistant_end_reasons = (
        "assistant-ended-call",
        "assistant-said-end-call-phrase",
        "assistant-ended-call-after-message-spoken",
    )
    if any(token in r for token in assistant_end_reasons):
        return ("completed", False)

    if r == "customer-ended-call":
        if transcript_length > 50:
            return ("completed", False)
        return ("dropped", True)

    # Normal completion with a substantive transcript
    if transcript_length > 200:
        return ("completed", False)

    # No answer / not reachable
    if r in ("customer-did-not-answer", "no-answer", "customer-busy", "call-forwarded"):
        return ("no_answer", True)

    # Voicemail
    if "voicemail" in r:
        return ("voicemail", True)

    # Technical failures
    if "error" in r or "failed" in r or "pipeline" in r:
        return ("failed", False)

    # Default — had a conversation transcript → completed
    if transcript_length > 0:
        return ("completed", False)
    return ("no_answer", True)


# ---------------------------------------------------------------------------
# Task 5.6b — Process Vapi webhook and extract structured fields via GPT-4o
# ---------------------------------------------------------------------------

@celery_app.task(name="tasks.process_screening_webhook", bind=True, max_retries=3)
def process_screening_webhook(self, payload: dict):
    """
    Celery task: process Vapi call-end webhook payload.

    Extracts transcript → calls GPT-4o for structured field extraction →
    updates ScreeningCall with results + call_status="completed".
    """
    try:
        asyncio.run(_async_process_webhook(self, payload))
    except Exception as exc:
        logger.error("process_screening_webhook failed: %s", exc)
        raise


async def _async_process_webhook(task_self, payload: dict) -> None:
    """Async inner: parse payload, classify outcome, run GPT-4o extraction, update DB."""
    import openai

    from app.models.models import ScreeningCall, Job
    from app.core.config import settings

    _, transcript, ended_reason = _extract_vapi_end_fields(payload)
    message = payload.get("message") or {}
    call_data = payload.get("call") or message.get("call") or {}
    vapi_call_id = call_data.get("id")
    transcript_length = len(transcript.strip())

    if not vapi_call_id:
        logger.warning("process_screening_webhook: no call.id in payload — skipping")
        return

    async with get_celery_db() as session:
        result = await session.execute(
            select(ScreeningCall).where(ScreeningCall.vapi_call_id == vapi_call_id)
        )
        screening_call = result.scalars().first()
        if not screening_call:
            logger.warning(
                "process_screening_webhook: no ScreeningCall found for vapi_call_id=%s",
                vapi_call_id,
            )
            return

        if screening_call.call_status not in ("completed", "failed"):
            await apply_screening_call_end(
                session,
                screening_call,
                ended_reason=ended_reason,
                transcript=transcript,
            )
            await session.refresh(screening_call)

        if not transcript:
            return

        if screening_call.result in ("pass", "fail"):
            return
        try:
            job_result = await session.execute(
                select(Job).where(Job.id == screening_call.job_id)
            )
            job = job_result.scalars().first()

            extracted = await _extract_screening_fields(
                transcript,
                settings.OPENAI_API_KEY,
                job_title=job.title if job else None,
                screening_questions=job.screening_questions if job else None,
            )

            screening_call.availability = extracted.get("availability")
            screening_call.employment_status = extracted.get("employment_status")
            screening_call.relevant_experience = extracted.get("relevant_experience")
            screening_call.current_ctc = extracted.get("current_ctc")
            screening_call.expected_ctc = extracted.get("expected_ctc")
            screening_call.notice_period = extracted.get("notice_period")
            screening_call.location_preference = extracted.get("location_preference")
            screening_call.communication_quality = extracted.get("communication_quality")
            # willingness_to_proceed may be bool or "true"/"false" string from GPT
            wtp = extracted.get("willingness_to_proceed")
            if isinstance(wtp, bool):
                screening_call.willingness_to_proceed = wtp
            elif isinstance(wtp, str):
                screening_call.willingness_to_proceed = wtp.lower() == "true"
            else:
                screening_call.willingness_to_proceed = None
            screening_call.summary = extracted.get("summary")
            screening_call.result = extracted.get("result", "needs_review")
            screening_call.call_status = "completed"
            screening_call.call_outcome = "completed"

            outcome, should_retry = classify_call_outcome(
                screening_call.ended_reason, transcript_length
            )
            if should_retry:
                from app.services.settings_service import can_schedule_retry, get_system_settings

                settings = await get_system_settings()
                if can_schedule_retry(screening_call.retry_count, settings.screening_max_retries):
                    await _schedule_retry(session, screening_call)

            await session.commit()
            logger.info(
                "Screening call %s processed: outcome=%s result=%s",
                vapi_call_id,
                screening_call.call_outcome,
                screening_call.result,
            )

        except openai.AuthenticationError as exc:
            logger.error("OpenAI auth error during webhook extraction — no retry: %s", exc)
            screening_call.call_status = "completed"
            screening_call.result = "needs_review"
            screening_call.summary = "GPT extraction failed (auth error). Manual review required."
            await session.commit()

        except openai.RateLimitError as exc:
            logger.warning("OpenAI rate limit during webhook extraction — retrying in 300s: %s", exc)
            await session.commit()  # Save transcript + outcome at least
            raise task_self.retry(exc=exc, countdown=300)

        except openai.APIConnectionError as exc:
            logger.warning("OpenAI connection error — retrying in 120s: %s", exc)
            await session.commit()
            raise task_self.retry(exc=exc, countdown=120)

        except Exception as exc:
            logger.error("GPT extraction failed for call %s: %s", vapi_call_id, exc)
            screening_call.call_status = "completed"
            screening_call.result = "needs_review"
            screening_call.summary = "GPT extraction failed. Manual review required."
            await session.commit()


async def _schedule_retry(session, screening_call) -> None:
    """Create a new ScreeningCall retry record and enqueue it with a delay."""
    from app.models.models import Job, ScreeningCall
    from app.services.call_window_service import effective_dispatch_delay
    from app.services.settings_service import can_schedule_retry, get_system_settings
    from app.tasks.screening_tasks import initiate_screening_call

    job_result = await session.execute(
        select(Job).where(Job.id == screening_call.job_id)
    )
    job = job_result.scalars().first()
    if not job:
        logger.error(
            "Cannot schedule retry — job %s not found for screening call %s",
            screening_call.job_id,
            screening_call.id,
        )
        return

    settings = await get_system_settings()
    if not can_schedule_retry(screening_call.retry_count, settings.screening_max_retries):
        logger.info(
            "Max retries (%d) reached for candidate=%s — not scheduling another retry",
            settings.screening_max_retries,
            screening_call.candidate_id,
        )
        return

    min_delay = settings.screening_retry_delay_seconds
    countdown, _immediate = effective_dispatch_delay(job, force=False, min_delay=min_delay)

    retry_call = ScreeningCall(
        candidate_id=screening_call.candidate_id,
        job_id=screening_call.job_id,
        call_status="pending",
        retry_count=screening_call.retry_count + 1,
    )
    session.add(retry_call)
    await session.flush()

    initiate_screening_call.apply_async(
        args=[str(retry_call.id)],
        countdown=countdown,
    )
    logger.info(
        "Scheduled retry #%d for candidate=%s in %ds (new screening_call_id=%s)",
        screening_call.retry_count + 1,
        screening_call.candidate_id,
        countdown,
        retry_call.id,
    )


# ---------------------------------------------------------------------------
# GPT-4o extraction helper
# ---------------------------------------------------------------------------

EXTRACTION_SYSTEM_PROMPT = """You are an expert HR analyst. You will be given a transcript of a phone screening call.
Extract the following structured information from the conversation. If a field is not mentioned, use null.

Return ONLY valid JSON with these exact fields:
{
  "availability": "string — when candidate can start (e.g. 'Immediately', 'In 30 days', '2 months')",
  "employment_status": "string — current employment status (e.g. 'Currently employed at XYZ', 'Unemployed')",
  "relevant_experience": "string — brief summary of relevant experience mentioned",
  "current_ctc": "string — current CTC/salary mentioned (e.g. '12 LPA', '15 lakhs', 'Not disclosed')",
  "expected_ctc": "string — expected CTC/salary (e.g. '18-20 LPA', 'Open to discussion')",
  "notice_period": "string — notice period (e.g. '30 days', '2 months', 'Immediate joiner')",
  "location_preference": "string — location or remote/hybrid preference",
  "communication_quality": "string — one of: excellent, good, fair, poor",
  "willingness_to_proceed": "boolean — true if candidate expressed interest in proceeding, false if not, null if unclear",
  "summary": "string — 2-3 sentence summary of the screening call",
  "result": "string — one of: pass, fail, needs_review"
}

Classifier rules for 'result':
- When employer screening questions are provided in the user message, verify answers cover those topics.
- "pass": candidate answers screening questions satisfactorily AND shows strong standard fit signals — willing to proceed, reasonable CTC expectations, relevant experience, acceptable availability and notice period.
- "fail": candidate gives clear disqualifying answers to screening questions OR shows clear disqualifiers — not willing to proceed, CTC extremely out of range (>2x stated), irrelevant experience, unavailable for foreseeable future.
- "needs_review": ambiguous signals, incomplete information, call cut short, mixed signals, or questions not fully answered.

Be conservative — when in doubt, use "needs_review" rather than "fail".
"""


async def _extract_screening_fields(
    transcript: str,
    api_key: str,
    *,
    job_title: str | None = None,
    screening_questions: list | None = None,
) -> dict:
    """Call GPT-4o to extract structured screening fields from transcript."""
    import openai

    from app.services.screening_defaults import format_screening_questions_for_prompt, merge_screening_questions

    client = openai.AsyncOpenAI(api_key=api_key)

    truncated_transcript = transcript[:12000]

    context_parts: list[str] = []
    if job_title:
        context_parts.append(f"Role: {job_title}")
    questions_text = format_screening_questions_for_prompt(
        merge_screening_questions(screening_questions, None, job_title or ""),
        job_title or "",
    )
    if questions_text.strip():
        context_parts.append(
            f"Employer screening questions (evaluate pass/fail based on how well these were answered):\n{questions_text}"
        )
    context_parts.append(f"Screening call transcript:\n\n{truncated_transcript}")
    user_content = "\n\n".join(context_parts)

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
        temperature=0,
        max_tokens=1000,
    )

    raw_content = response.choices[0].message.content
    extracted = json.loads(raw_content)
    return extracted


# ---------------------------------------------------------------------------
# Periodic — dispatch stale pending screening calls when window opens
# ---------------------------------------------------------------------------

@celery_app.task(name="tasks.dispatch_pending_screening_calls")
def dispatch_pending_screening_calls():
    """Safety net: enqueue pending calls stuck without vapi_call_id when window is open."""
    try:
        asyncio.run(_async_dispatch_pending())
    except Exception as exc:
        logger.error("dispatch_pending_screening_calls failed: %s", exc)
        raise


async def _async_dispatch_pending() -> None:
    from datetime import datetime, timedelta, timezone

    from app.models.models import Job, ScreeningCall
    from app.services.call_window_service import is_within_call_window
    from app.services.settings_service import get_system_settings

    stale_active_cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    now = datetime.now(timezone.utc)
    settings = await get_system_settings()

    async with get_celery_db() as session:
        stale_active = await session.execute(
            select(ScreeningCall).where(
                ScreeningCall.call_status.in_(LIVE_CALL_STATUSES),
                ScreeningCall.vapi_call_id.isnot(None),
                ScreeningCall.created_at < stale_active_cutoff,
            )
        )
        finalized = 0
        for screening_call in stale_active.scalars().all():
            if await _finalize_screening_call_from_vapi(session, screening_call, force=True):
                finalized += 1

        if finalized:
            logger.info(
                "dispatch_pending_screening_calls: force-finalized %d stale active calls",
                finalized,
            )

        result = await session.execute(
            select(ScreeningCall, Job)
            .join(Job, ScreeningCall.job_id == Job.id)
            .where(
                ScreeningCall.call_status == "pending",
                ScreeningCall.vapi_call_id.is_(None),
            )
        )
        rows = result.all()

        dispatched = 0
        for screening_call, job in rows:
            if not is_within_call_window(job):
                continue

            created = screening_call.created_at
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            age_sec = (now - created).total_seconds()

            # Let _schedule_retry's delayed Celery task place retry dials — don't race ahead.
            if screening_call.retry_count > 0:
                min_delay = max(settings.screening_retry_delay_seconds - 10, 0)
                if age_sec < min_delay:
                    continue

            initiate_screening_call.apply_async(args=[str(screening_call.id)], countdown=0)
            dispatched += 1

        if dispatched:
            logger.info("dispatch_pending_screening_calls: dispatched %d pending calls", dispatched)
