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
from app.core.config_loader import config
from app.core.database import get_celery_db
from app.prompts.screening import (
    EXTRACTION_SYSTEM_PROMPT,
    build_screening_extraction_user_prompt,
)

logger = logging.getLogger(__name__)

_s = config.screening
SCREENING_SYNC_INITIAL_DELAY_SEC = _s.poll.initial_delay_sec
SCREENING_SYNC_POLL_INTERVAL_SEC = _s.poll.interval_sec
SCREENING_SYNC_MAX_POLLS = _s.poll.max_polls
VAPI_STATUS_TIMEOUT_SEC = _s.poll.status_timeout_sec
MIN_LIVE_CALL_GRACE_SECONDS = _s.grace.live_call_sec
MIN_RETRY_CALL_GRACE_SECONDS = _s.grace.retry_call_sec
# After a live conversation ends, Vapi often needs a few seconds before artifact.transcript
# is available. Wait/re-poll before treating the call as dropped and scheduling a retry.
TRANSCRIPT_ENRICH_MAX_ATTEMPTS = _s.transcript_enrich.max_attempts
TRANSCRIPT_ENRICH_DELAY_SEC = _s.transcript_enrich.delay_sec
# Wait for enrich to finish (plus buffer) before emailing "unable to connect".
FAILED_EMAIL_DELAY_SEC = _s.failed_email_delay_sec
# Transcript shorter than this is treated as partial — wait for Vapi artifact.
MIN_SUBSTANTIVE_TRANSCRIPT_CHARS = _s.min_substantive_transcript_chars
RAPID_REDIAL_GUARD_SEC = _s.grace.rapid_redial_guard_sec
SCREENING_REDISPATCH_DELAY_SEC = _s.redispatch_delay_sec
STALE_ACTIVE_CALL_MINUTES = _s.stale_active_call_minutes
MAX_CALL_DURATION_MINUTES = _s.max_call_duration_minutes
LIVE_SLOT_DEFER_SEC = _s.live_slot_defer_sec

LIVE_CALL_STATUSES = ("initiated", "in_progress")
TERMINAL_CALL_STATUSES = frozenset({"completed", "failed"})


def can_set_call_status(current: str | None, new: str) -> bool:
    """Reject any transition that would leave a terminal status."""
    if (current or "") in TERMINAL_CALL_STATUSES:
        return False
    return True


def set_call_status_if_allowed(screening_call, new_status: str) -> bool:
    """Set call_status only when not regressing from terminal. Returns True if applied."""
    if not can_set_call_status(screening_call.call_status, new_status):
        logger.debug(
            "Ignoring status transition %s -> %s for screening_call %s",
            screening_call.call_status,
            new_status,
            getattr(screening_call, "id", None),
        )
        return False
    screening_call.call_status = new_status
    return True


# End reasons that imply the candidate was connected (even if transcript is not ready yet).
CONNECTED_END_REASONS = (
    "customer-ended-call",
    "assistant-ended-call",
    "assistant-said-end-call-phrase",
    "assistant-ended-call-after-message-spoken",
    "silence-timed-out",
    "max-duration-reached",
)

PURE_MISS_END_REASONS = frozenset(
    {
        "customer-did-not-answer",
        "no-answer",
        "customer-busy",
        "call-forwarded",
        "busy",
    }
)


def should_wait_for_transcript(
    *,
    transcript: str,
    started_at,
    ended_reason: str | None,
    call_status: str | None = None,
    force: bool = False,
) -> bool:
    """
    True when the call likely connected and the Vapi transcript may still be incomplete.

    Parks the call instead of classifying dropped/no_answer (and emailing) too early.
    """
    if force:
        return False

    text = (transcript or "").strip()
    reason = (ended_reason or "").lower()
    connected = bool(started_at) or reason in CONNECTED_END_REASONS
    # in_progress includes ringing; still wait unless this is a clear miss end-reason.
    was_live = (call_status or "") == "in_progress"
    clear_miss = reason in PURE_MISS_END_REASONS

    if clear_miss and not started_at and not text:
        return False

    if connected or (was_live and not clear_miss):
        return len(text) < MIN_SUBSTANTIVE_TRANSCRIPT_CHARS

    return False


def schedule_deferred_failed_screening_email(screening_call_id) -> None:
    """Queue a delayed re-check so success after late transcript does not email a false failure."""
    send_failed_screening_email_deferred.apply_async(
        args=[str(screening_call_id)],
        countdown=FAILED_EMAIL_DELAY_SEC,
    )


# ---------------------------------------------------------------------------
# Task 5.6a — Initiate outbound Vapi screening call
# ---------------------------------------------------------------------------

@celery_app.task(
    name="tasks.initiate_screening_call",
    bind=True,
    max_retries=config.celery.default_max_retries,
)
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
            select(ScreeningCall)
            .where(ScreeningCall.id == uuid.UUID(screening_call_id))
            .with_for_update(skip_locked=True)
        )
        screening_call = result.scalars().first()
        if not screening_call:
            logger.info(
                "ScreeningCall %s locked by another worker — skipping initiate",
                screening_call_id,
            )
            return

        if screening_call.vapi_call_id or screening_call.call_status != "pending":
            logger.info(
                "ScreeningCall %s already dispatched (status=%s) — skipping duplicate initiate",
                screening_call_id,
                screening_call.call_status,
            )
            return

        # Load Job (needed for tenant settings and call window)
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

        from app.services.screening_gate_service import (
            is_voice_screening_effective,
            screening_disabled_reason,
        )
        from app.services.settings_service import load_system_settings

        system_settings = await load_system_settings(session, tenant_id=job.tenant_id)
        if not is_voice_screening_effective(system_settings, job):
            disabled_reason = screening_disabled_reason(system_settings, job)
            logger.info(
                "Screening disabled — aborting initiate for ScreeningCall %s",
                screening_call_id,
            )
            screening_call.call_status = "failed"
            screening_call.summary = disabled_reason or "Voice screening is disabled"
            await session.commit()
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
            initiate_screening_call.apply_async(
                args=[screening_call_id],
                countdown=SCREENING_REDISPATCH_DELAY_SEC,
            )
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

        from app.services.screening_queue_service import has_live_screening_slot

        if not await has_live_screening_slot(session, job.tenant_id):
            logger.info(
                "ScreeningCall %s deferred — tenant at live-call cap (%s)",
                screening_call_id,
                config.concurrency.max_live_screening_calls,
            )
            initiate_screening_call.apply_async(
                args=[screening_call_id],
                countdown=LIVE_SLOT_DEFER_SEC,
            )
            return

        # Call Vapi
        try:
            from app.services.tenant_integrations_service import load_tenant_integrations

            integrations = await load_tenant_integrations(session, job.tenant_id)
            vapi_call_id = await vapi_initiate(
                candidate=candidate,
                job=job,
                screening_call_id=screening_call.id,
                integrations=integrations,
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
            err_str = str(exc).lower()
            is_config_error = (
                "401" in err_str
                or "403" in err_str
                or "api key" in err_str
                or "transport" in err_str
                or "validation" in err_str
            )
            screening_call.vapi_call_id = None
            screening_call.summary = str(exc)[:500]

            if is_config_error:
                # Non-retryable — mark failed permanently.
                screening_call.call_status = "failed"
                screening_call.call_outcome = "failed"
                await session.commit()
                logger.error("Config/auth error — not retrying: %s", exc)
                return

            # Keep pending so Celery retries can re-enter the dial path.
            screening_call.call_status = "pending"
            screening_call.call_outcome = None
            await session.commit()
            try:
                raise task_self.retry(
                    exc=exc, countdown=config.celery.transient_countdown_sec
                )
            except Exception as retry_exc:
                from celery.exceptions import MaxRetriesExceededError

                if not isinstance(retry_exc, MaxRetriesExceededError):
                    raise
                screening_call.call_status = "failed"
                screening_call.call_outcome = "failed"
                screening_call.summary = (
                    f"Vapi dial failed after retries: {str(exc)[:400]}"
                )
                await session.commit()
                logger.error(
                    "Vapi dial retries exhausted for screening_call %s",
                    screening_call_id,
                )
                return


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
        await session.refresh(screening_call)

        # Parking for transcript enrichment leaves the call in_progress — keep polling
        # until it becomes terminal (completed/failed) or we hit max polls.
        if finalized and screening_call.call_status in ("completed", "failed"):
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
        if (screening_call.retry_count or 0) > 0 and age_sec < RAPID_REDIAL_GUARD_SEC:
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


async def _vapi_api_key_for_screening_call(session, screening_call) -> str:
    from app.models.models import Job
    from app.services.tenant_integrations_service import load_tenant_integrations

    job_result = await session.execute(
        select(Job).where(Job.id == screening_call.job_id)
    )
    job = job_result.scalars().first()
    if not job:
        raise ValueError(f"Job {screening_call.job_id} not found for screening call")
    integrations = await load_tenant_integrations(session, job.tenant_id)
    integrations.require("vapi_api_key")
    return integrations.vapi_api_key


async def _finalize_screening_call_from_vapi(
    session,
    screening_call,
    *,
    force: bool = False,
) -> bool:
    """Poll Vapi once and finalize the screening call when the dial has ended."""
    from app.services.vapi_service import get_vapi_call

    if screening_call.call_status in TERMINAL_CALL_STATUSES:
        return False
    if not screening_call.vapi_call_id:
        return False

    vapi_call: dict | None = None
    try:
        api_key = await _vapi_api_key_for_screening_call(session, screening_call)
        vapi_call = await get_vapi_call(
            screening_call.vapi_call_id,
            timeout=VAPI_STATUS_TIMEOUT_SEC,
            api_key=api_key,
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
        # Force = give up waiting. Classify with the best known reason so we don't
        # invent a fresh no-answer that emails "unable to connect" incorrectly when
        # we already know the call connected (e.g. customer-ended-call).
        await apply_screening_call_end(
            session,
            screening_call,
            ended_reason=screening_call.ended_reason or "customer-did-not-answer",
            transcript=screening_call.transcript or "",
            schedule_retry=True,
            send_failure_email=True,
            awaiting_transcript=False,
        )
        return True

    vapi_status, mapped, ended_reason, transcript, _ended_at = _parse_vapi_call_payload(
        vapi_call
    )
    started_at = vapi_call.get("startedAt") or vapi_call.get("started_at")

    if mapped in LIVE_CALL_STATUSES and mapped != screening_call.call_status:
        if set_call_status_if_allowed(screening_call, mapped):
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

    needs_transcript_wait = should_wait_for_transcript(
        transcript=transcript,
        started_at=started_at,
        ended_reason=resolved_reason,
        call_status=screening_call.call_status,
        force=force,
    )

    finalized = await apply_screening_call_end(
        session,
        screening_call,
        ended_reason=resolved_reason,
        transcript=transcript,
        # Conversation started but transcript not ready yet — enrich later, don't redial.
        schedule_retry=not needs_transcript_wait,
        send_failure_email=not needs_transcript_wait,
        awaiting_transcript=needs_transcript_wait,
    )
    if not finalized:
        return False

    if transcript.strip() and vapi_call is not None:
        artifact = vapi_call.get("artifact") or {}
        payload = {
            "call": vapi_call,
            "artifact": artifact,
            "endedReason": resolved_reason,
        }
        process_screening_webhook.delay(payload)
    elif needs_transcript_wait:
        enrich_screening_transcript.apply_async(
            args=[str(screening_call.id), 0],
            countdown=TRANSCRIPT_ENRICH_DELAY_SEC,
        )
        logger.info(
            "Scheduled transcript enrichment for screening_call=%s (ended_reason=%s)",
            screening_call.id,
            resolved_reason,
        )
    return True


@celery_app.task(name="tasks.enrich_screening_transcript", bind=True, max_retries=0)
def enrich_screening_transcript(self, screening_call_id: str, attempt: int = 0):
    """
    Re-fetch Vapi artifact after call end — transcript often arrives a few seconds late.

    If found: update the ScreeningCall, cancel any pending retries, run GPT extraction.
    If exhausted with no transcript: schedule a retry when the outcome warrants it.
    """
    try:
        asyncio.run(_async_enrich_transcript(screening_call_id, attempt))
    except Exception as exc:
        logger.error(
            "enrich_screening_transcript failed for %s: %s", screening_call_id, exc
        )


async def _async_enrich_transcript(screening_call_id: str, attempt: int) -> None:
    from app.models.models import ScreeningCall
    from app.services.vapi_service import get_vapi_call

    async with get_celery_db() as session:
        result = await session.execute(
            select(ScreeningCall).where(ScreeningCall.id == uuid.UUID(screening_call_id))
        )
        screening_call = result.scalars().first()
        if not screening_call or not screening_call.vapi_call_id:
            return

        # Already enriched successfully
        if (screening_call.transcript or "").strip() and screening_call.call_outcome == "completed":
            await _cancel_pending_retries(
                session,
                candidate_id=screening_call.candidate_id,
                job_id=screening_call.job_id,
                except_call_id=screening_call.id,
            )
            await session.commit()
            return

        try:
            api_key = await _vapi_api_key_for_screening_call(session, screening_call)
            vapi_call = await get_vapi_call(
                screening_call.vapi_call_id,
                timeout=VAPI_STATUS_TIMEOUT_SEC,
                api_key=api_key,
            )
        except Exception as exc:
            logger.warning(
                "enrich_screening_transcript: Vapi fetch failed for %s: %s",
                screening_call_id,
                exc,
            )
            vapi_call = None

        transcript = ""
        ended_reason = screening_call.ended_reason
        if vapi_call:
            _, _, ended_reason_from_vapi, transcript, _ = _parse_vapi_call_payload(vapi_call)
            if ended_reason_from_vapi:
                ended_reason = ended_reason_from_vapi

        if transcript.strip():
            screening_call.transcript = transcript
            screening_call.ended_reason = ended_reason
            screening_call.call_status = "completed"
            screening_call.call_outcome = "completed"
            screening_call.result = screening_call.result or "needs_review"
            await _cancel_pending_retries(
                session,
                candidate_id=screening_call.candidate_id,
                job_id=screening_call.job_id,
                except_call_id=screening_call.id,
            )
            await session.commit()
            logger.info(
                "enrich_screening_transcript: recovered transcript for %s (%d chars)",
                screening_call_id,
                len(transcript),
            )
            artifact = (vapi_call or {}).get("artifact") or {}
            process_screening_webhook.delay(
                {
                    "call": vapi_call or {"id": screening_call.vapi_call_id},
                    "artifact": artifact,
                    "endedReason": ended_reason,
                }
            )
            return

        if attempt + 1 < TRANSCRIPT_ENRICH_MAX_ATTEMPTS:
            enrich_screening_transcript.apply_async(
                args=[screening_call_id, attempt + 1],
                countdown=TRANSCRIPT_ENRICH_DELAY_SEC,
            )
            return

        logger.warning(
            "enrich_screening_transcript: no transcript after %d attempts for %s — evaluating retry",
            TRANSCRIPT_ENRICH_MAX_ATTEMPTS,
            screening_call_id,
        )
        # Transcript never arrived — now safe to classify as a real connect failure and notify.
        finalized = await apply_screening_call_end(
            session,
            screening_call,
            ended_reason=ended_reason,
            transcript=screening_call.transcript or "",
            schedule_retry=True,
            # Enrichment already waited; send immediately if still a failure.
            send_failure_email=False,
            awaiting_transcript=False,
        )
        from app.services.failed_screening_email_service import maybe_send_failed_screening_email

        if not finalized:
            await session.refresh(screening_call)
        await maybe_send_failed_screening_email(session, screening_call)


@celery_app.task(name="tasks.send_failed_screening_email_deferred", bind=True, max_retries=0)
def send_failed_screening_email_deferred(self, screening_call_id: str):
    """
    Re-check after enrichment window before sending "unable to connect".

    Prevents false emails when Vapi briefly reports dropped/no_answer and then
    delivers the full transcript a few seconds later.
    """
    try:
        asyncio.run(_async_send_failed_screening_email_deferred(screening_call_id))
    except Exception as exc:
        logger.error(
            "send_failed_screening_email_deferred failed for %s: %s",
            screening_call_id,
            exc,
        )


async def _async_send_failed_screening_email_deferred(screening_call_id: str) -> None:
    from app.models.models import ScreeningCall
    from app.services.failed_screening_email_service import (
        FAILED_OUTCOMES,
        maybe_send_failed_screening_email,
    )

    async with get_celery_db() as session:
        result = await session.execute(
            select(ScreeningCall).where(ScreeningCall.id == uuid.UUID(screening_call_id))
        )
        screening_call = result.scalars().first()
        if not screening_call:
            return

        outcome = (screening_call.call_outcome or "").lower()
        transcript = (screening_call.transcript or "").strip()
        if outcome == "completed" or len(transcript) > MIN_SUBSTANTIVE_TRANSCRIPT_CHARS:
            logger.info(
                "Skipping deferred failure email for %s — call succeeded (outcome=%s, transcript=%d)",
                screening_call_id,
                outcome,
                len(transcript),
            )
            return
        if screening_call.result in ("pass", "fail"):
            return
        if outcome not in FAILED_OUTCOMES and screening_call.call_status != "failed":
            # Still in progress / parking — do not email.
            logger.info(
                "Skipping deferred failure email for %s — not a failure yet (status=%s outcome=%s)",
                screening_call_id,
                screening_call.call_status,
                outcome,
            )
            return

        await maybe_send_failed_screening_email(session, screening_call)


async def refresh_live_screening_calls_from_vapi(session, screening_calls) -> bool:
    """Eagerly poll Vapi for in-flight calls. Returns True if any call was finalized.

    Runs sequentially on the shared request session — concurrent gathers on one
    AsyncSession are not safe.
    """
    live_calls = [
        call
        for call in screening_calls
        if call.call_status in LIVE_CALL_STATUSES and call.vapi_call_id
    ]
    if not live_calls:
        return False

    any_updated = False
    for call in live_calls:
        try:
            if await _finalize_screening_call_from_vapi(session, call, force=False):
                any_updated = True
        except Exception as exc:
            logger.warning(
                "Live screening refresh failed for %s: %s",
                getattr(call, "id", None),
                exc,
            )
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
    send_failure_email: bool = True,
    awaiting_transcript: bool = False,
) -> bool:
    """
    Immediately mark a ScreeningCall as finished (no GPT).

    When awaiting_transcript=True the phone conversation likely connected but Vapi has
    not delivered the transcript yet — keep the call non-terminal so we do not flash
    "Unable to Connect" or email a false failure before enrichment completes.

    Returns True if the call was finalized (or parked for enrichment), False if already terminal.
    """
    if screening_call.call_status in TERMINAL_CALL_STATUSES:
        return False

    if awaiting_transcript and len((transcript or "").strip()) < MIN_SUBSTANTIVE_TRANSCRIPT_CHARS:
        screening_call.ended_reason = ended_reason or screening_call.ended_reason
        if transcript and transcript.strip():
            # Keep any early fragment while waiting for the full artifact.
            screening_call.transcript = transcript
        set_call_status_if_allowed(screening_call, "in_progress")
        # Clear any provisional failure outcome so the UI does not flash "Unable to Connect".
        screening_call.call_outcome = None
        await session.commit()
        return True

    transcript_length = len((transcript or "").strip())
    outcome, should_retry = classify_call_outcome(ended_reason, transcript_length)

    screening_call.ended_reason = ended_reason
    screening_call.call_outcome = outcome
    if transcript:
        screening_call.transcript = transcript

    if outcome == "failed":
        set_call_status_if_allowed(screening_call, "failed")
        screening_call.result = None
        screening_call.summary = describe_screening_failure(ended_reason)
        await session.commit()
        if send_failure_email:
            schedule_deferred_failed_screening_email(screening_call.id)
        return True

    set_call_status_if_allowed(screening_call, "completed")
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
        from app.models.models import Job
        from app.services.settings_service import can_schedule_retry, load_system_settings

        job_result = await session.execute(
            select(Job).where(Job.id == screening_call.job_id)
        )
        job = job_result.scalars().first()
        settings = await load_system_settings(
            session, tenant_id=job.tenant_id if job else None
        )
        if can_schedule_retry(screening_call.retry_count, settings.screening_max_retries):
            await _schedule_retry(session, screening_call)

    if outcome == "completed" and transcript.strip():
        await _cancel_pending_retries(
            session,
            candidate_id=screening_call.candidate_id,
            job_id=screening_call.job_id,
            except_call_id=screening_call.id,
        )

    await session.commit()

    # Never email "unable to connect" synchronously — a late transcript often flips
    # dropped/no_answer → completed a few seconds later. Deferred task re-checks.
    if send_failure_email and outcome in ("no_answer", "voicemail", "dropped"):
        schedule_deferred_failed_screening_email(screening_call.id)

    return True


def classify_call_outcome(ended_reason: str | None, transcript_length: int) -> tuple[str, bool]:
    """
    Returns (outcome_label, should_retry).

    outcome_label: "completed" | "no_answer" | "voicemail" | "declined" | "dropped" | "failed"
    should_retry: True if we should auto-schedule a retry call
    """
    if ended_reason:
        r = ended_reason.lower()
        if "voicemail" in r:
            return ("voicemail", True)

    # Substantive conversation — completed even if carrier reports no-answer/dropped.
    if transcript_length > MIN_SUBSTANTIVE_TRANSCRIPT_CHARS:
        return ("completed", False)

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

    # Any spoken content after a customer hangup means the call connected.
    if r == "customer-ended-call":
        if transcript_length > 0:
            return ("completed", False)
        return ("dropped", True)

    # Normal completion with a substantive transcript
    if transcript_length > 200:
        return ("completed", False)

    # No answer / not reachable
    if r in ("customer-did-not-answer", "no-answer", "customer-busy", "call-forwarded"):
        return ("no_answer", True)

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

@celery_app.task(
    name="tasks.process_screening_webhook",
    bind=True,
    max_retries=config.celery.default_max_retries,
)
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
    from app.services.tenant_integrations_service import load_tenant_integrations

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
            if not job:
                logger.warning(
                    "process_screening_webhook: job %s not found for screening call %s",
                    screening_call.job_id,
                    screening_call.id,
                )
                return

            integrations = await load_tenant_integrations(session, job.tenant_id)
            integrations.require("openai_api_key")

            extracted = await _extract_screening_fields(
                transcript,
                integrations.openai_api_key,
                job_title=job.title,
                screening_questions=job.screening_questions,
            )

            screening_call.availability = _clean_extracted_str(extracted.get("availability"))
            screening_call.employment_status = _clean_extracted_str(extracted.get("employment_status"))
            screening_call.relevant_experience = _clean_extracted_str(extracted.get("relevant_experience"))
            screening_call.current_ctc = _clean_extracted_str(extracted.get("current_ctc"))
            screening_call.expected_ctc = _clean_extracted_str(extracted.get("expected_ctc"))
            screening_call.notice_period = _clean_extracted_str(extracted.get("notice_period"))
            screening_call.location_preference = _clean_extracted_str(extracted.get("location_preference"))
            screening_call.communication_quality = _clean_extracted_str(extracted.get("communication_quality"))
            # willingness_to_proceed may be bool or "true"/"false" string from GPT
            wtp = extracted.get("willingness_to_proceed")
            if isinstance(wtp, bool):
                screening_call.willingness_to_proceed = wtp
            elif isinstance(wtp, str):
                screening_call.willingness_to_proceed = wtp.lower() == "true"
            else:
                screening_call.willingness_to_proceed = None
            screening_call.summary = _clean_extracted_str(extracted.get("summary"))
            screening_call.result = extracted.get("result", "needs_review")
            screening_call.call_status = "completed"
            screening_call.call_outcome = "completed"

            await _cancel_pending_retries(
                session,
                candidate_id=screening_call.candidate_id,
                job_id=screening_call.job_id,
                except_call_id=screening_call.id,
            )

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
            raise task_self.retry(exc=exc, countdown=config.celery.rate_limit_countdown_sec)

        except openai.APIConnectionError as exc:
            logger.warning("OpenAI connection error — retrying in 120s: %s", exc)
            await session.commit()
            raise task_self.retry(exc=exc, countdown=config.celery.transient_countdown_sec)

        except Exception as exc:
            logger.error("GPT extraction failed for call %s: %s", vapi_call_id, exc)
            screening_call.call_status = "completed"
            screening_call.result = "needs_review"
            screening_call.summary = "GPT extraction failed. Manual review required."
            await session.commit()


async def _cancel_pending_retries(
    session,
    *,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    except_call_id: uuid.UUID | None = None,
) -> int:
    """Delete queued retry rows once a screening call completes successfully."""
    from app.models.models import ScreeningCall

    result = await session.execute(
        select(ScreeningCall).where(
            ScreeningCall.candidate_id == candidate_id,
            ScreeningCall.job_id == job_id,
            ScreeningCall.call_status == "pending",
            ScreeningCall.vapi_call_id.is_(None),
        )
    )
    cancelled = 0
    for pending_call in result.scalars().all():
        if except_call_id and pending_call.id == except_call_id:
            continue
        await session.delete(pending_call)
        cancelled += 1
    if cancelled:
        logger.info(
            "Cancelled %d pending screening retry(ies) for candidate=%s after successful call",
            cancelled,
            candidate_id,
        )
    return cancelled


async def _schedule_retry(session, screening_call) -> None:
    """Create a new ScreeningCall retry record and enqueue it with a delay."""
    from app.models.models import Job, ScreeningCall
    from app.services.call_window_service import effective_dispatch_delay
    from app.services.settings_service import can_schedule_retry, load_system_settings
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

    settings = await load_system_settings(session, tenant_id=job.tenant_id)
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

def _clean_extracted_str(value) -> str | None:
    """Coerce GPT null-ish string values to None so the UI never shows literal 'null'."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.lower() in {"null", "none", "n/a", "na", "undefined", "-"}:
        return None
    return text


async def _extract_screening_fields(
    transcript: str,
    api_key: str,
    *,
    job_title: str | None = None,
    screening_questions: list | None = None,
) -> dict:
    """Call GPT-4o to extract structured screening fields from transcript."""
    from app.clients import mocks

    if mocks.mock_openai_enabled():
        return mocks.mock_screening_extraction()

    from app.services.screening_defaults import format_screening_questions_for_prompt, merge_screening_questions
    from app.clients import openai_client

    questions_text = format_screening_questions_for_prompt(
        merge_screening_questions(screening_questions, None, job_title or ""),
        job_title or "",
    )
    user_content = build_screening_extraction_user_prompt(
        transcript=transcript,
        job_title=job_title,
        questions_text=questions_text,
    )

    raw_content = await openai_client().chat_completion_json(
        "screening_extraction",
        [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        api_key=api_key,
    )
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

    async with get_celery_db() as session:
        max_duration_cutoff = datetime.now(timezone.utc) - timedelta(
            minutes=MAX_CALL_DURATION_MINUTES
        )
        now = datetime.now(timezone.utc)

        # Only force-finalize calls that exceeded max duration (healthy live calls
        # under that window are left alone; normal poll/webhook finalize them).
        overdue_active = await session.execute(
            select(ScreeningCall).where(
                ScreeningCall.call_status.in_(LIVE_CALL_STATUSES),
                ScreeningCall.vapi_call_id.isnot(None),
                ScreeningCall.created_at < max_duration_cutoff,
            )
        )
        finalized = 0
        for screening_call in overdue_active.scalars().all():
            # Prefer gentle finalize (Vapi-ended); force only if still live past max duration.
            if await _finalize_screening_call_from_vapi(
                session, screening_call, force=False
            ):
                finalized += 1
                continue
            if await _finalize_screening_call_from_vapi(
                session, screening_call, force=True
            ):
                finalized += 1

        if finalized:
            logger.info(
                "dispatch_pending_screening_calls: force-finalized %d overdue active calls",
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
            from app.services.screening_gate_service import is_voice_screening_effective
            from app.services.settings_service import load_system_settings

            settings = await load_system_settings(session, tenant_id=job.tenant_id)
            if not is_voice_screening_effective(settings, job):
                continue

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

        from app.services.screening_trigger_service import (
            auto_dispatch_unqueued_approved_for_job,
        )

        jobs_result = await session.execute(select(Job))
        auto_initiated = 0
        auto_queued = 0
        for job in jobs_result.scalars().all():
            if not is_within_call_window(job):
                continue
            initiated, queued = await auto_dispatch_unqueued_approved_for_job(
                session, job
            )
            auto_initiated += initiated
            auto_queued += queued

        if auto_initiated or auto_queued:
            logger.info(
                "dispatch_pending_screening_calls: auto-dispatched new approvals "
                "initiated=%d queued=%d",
                auto_initiated,
                auto_queued,
            )
