import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.config_loader import config
from app.core.database import get_celery_db
from app.models.models import Candidate
from app.services.document_extractor import (
    UnsupportedDocumentError,
    extract_text_from_bytes,
)
from app.services.parse_queue_service import dispatch_parse_slots

logger = logging.getLogger(__name__)


class _NoRetryError(Exception):
    """Sentinel to abort retry on unrecoverable errors (e.g. missing file)."""


def _load_resume_bytes(candidate: Candidate) -> tuple[bytes, str]:
    """Load resume bytes from S3 or local disk. Returns (bytes, suffix)."""
    from app.services.s3_service import download_bytes, is_s3_object_key  # noqa: PLC0415

    stored = candidate.resume_file_path or ""
    if is_s3_object_key(stored):
        file_bytes = download_bytes(stored)
        suffix = Path(stored).suffix.lower() or Path(
            candidate.original_filename or ""
        ).suffix.lower()
        return file_bytes, suffix

    file_path = Path(stored)
    if not file_path.exists():
        raise FileNotFoundError(stored)
    return file_path.read_bytes(), file_path.suffix.lower()


def _filename_for_extract(candidate: Candidate, suffix: str) -> str:
    return candidate.original_filename or f"resume{suffix}"


# ---------------------------------------------------------------------------
# Task 3.3 — Raw text extraction
# ---------------------------------------------------------------------------

@celery_app.task(
    name="tasks.extract_resume_text",
    bind=True,
    max_retries=config.celery.default_max_retries,
)
def extract_resume_text(self, candidate_id: str):
    """Extract text from the stored resume file and chain to structured parse.

    Does not persist raw text in the DB — the resume file in storage is the source.
    Does not pass resume text through Celery args (PII stays out of the broker).
    File-not-found: marks parse_failed immediately, does NOT retry.
    Other failures: retries up to 3 times with 60-second countdown.
    """
    try:
        asyncio.run(_async_extract(candidate_id))
    except _NoRetryError:
        pass
    except Exception as exc:
        logger.error("extract_resume_text failed for candidate %s: %s", candidate_id, exc)
        raise self.retry(exc=exc, countdown=config.celery.extraction_countdown_sec)


async def _async_extract(candidate_id: str) -> None:
    async with get_celery_db() as session:
        result = await session.execute(
            select(Candidate).where(Candidate.id == uuid.UUID(candidate_id))
        )
        candidate = result.scalar_one_or_none()

        if not candidate:
            logger.warning(
                "extract_resume_text: candidate %s not found in DB — skipping", candidate_id
            )
            return

        job_id = candidate.job_id

        if candidate.parse_status not in ("parse_queued", "pending_parse", "parsing"):
            logger.info(
                "extract_resume_text: candidate %s not queued (status=%s) — skipping",
                candidate_id,
                candidate.parse_status,
            )
            return

        candidate.parse_status = "parsing"
        if candidate.parse_started_at is None:
            candidate.parse_started_at = datetime.now(timezone.utc)
        await session.commit()

        try:
            try:
                file_bytes, suffix = _load_resume_bytes(candidate)
            except FileNotFoundError as exc:
                logger.error(
                    "extract_resume_text: file not found for candidate %s — path: %s",
                    candidate_id,
                    candidate.resume_file_path,
                )
                candidate.parse_status = "parse_failed"
                candidate.parse_started_at = None
                await session.commit()
                await dispatch_parse_slots(session, job_id)
                raise _NoRetryError(f"File not found: {exc}") from exc
            except Exception as exc:
                # S3 download / IO failures that won't self-heal without re-upload
                if "NoSuchKey" in type(exc).__name__ or "404" in str(exc):
                    logger.error(
                        "extract_resume_text: storage miss for candidate %s — %s",
                        candidate_id,
                        exc,
                    )
                    candidate.parse_status = "parse_failed"
                    candidate.parse_started_at = None
                    await session.commit()
                    await dispatch_parse_slots(session, job_id)
                    raise _NoRetryError(str(exc)) from exc
                raise

            try:
                text = extract_text_from_bytes(
                    file_bytes, _filename_for_extract(candidate, suffix)
                )
            except UnsupportedDocumentError as exc:
                logger.warning(
                    "extract_resume_text: unsupported document for candidate %s — %s",
                    candidate_id,
                    exc,
                )
                candidate.parse_status = "parse_failed"
                candidate.parse_started_at = None
                await session.commit()
                await dispatch_parse_slots(session, job_id)
                raise _NoRetryError(str(exc)) from exc

            if not text:
                logger.warning(
                    "extract_resume_text: empty text for candidate %s — marking failed",
                    candidate_id,
                )
                candidate.parse_status = "parse_failed"
                candidate.parse_started_at = None
                await session.commit()
                await dispatch_parse_slots(session, job_id)
                raise _NoRetryError("Empty resume text")

            logger.info(
                "Extracted text from resume for candidate %s (%d chars)",
                candidate_id,
                len(text),
            )
            # PII-safe: pass candidate_id only — parse task re-extracts from storage
            parse_resume.apply_async(args=[candidate_id])

        except _NoRetryError:
            raise

        except Exception as exc:
            logger.error(
                "Text extraction failed for candidate %s: %s", candidate_id, exc
            )
            candidate.parse_status = "parse_failed"
            candidate.parse_started_at = None
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            raise


# ==========================================================================
# Task 3.5 — structured resume parse
# ==========================================================================

@celery_app.task(
    name="tasks.parse_resume",
    bind=True,
    max_retries=config.celery.default_max_retries,
)
def parse_resume(self, candidate_id: str, raw_text: str = ""):
    """Parse resume text with GPT-4o into structured fields.

    raw_text is ignored when provided (legacy Celery args); text is always
    re-extracted from stored resume bytes so PII is not kept in the broker.
    Sets parse_status → 'ready' on success.
    """
    try:
        asyncio.run(_async_parse(candidate_id))
    except Exception as exc:
        logger.error("parse_resume failed for candidate %s: %s", candidate_id, exc)
        raise


async def _async_parse(candidate_id: str) -> None:
    import openai  # local import — not installed at task discovery time

    from app.models.models import Job
    from app.services.resume_parser import parse_resume as parse_resume_service
    from app.services.tenant_integrations_service import load_tenant_integrations

    async with get_celery_db() as session:
        result = await session.execute(
            select(Candidate).where(Candidate.id == uuid.UUID(candidate_id))
        )
        candidate = result.scalar_one_or_none()

        if not candidate:
            logger.warning(
                "parse_resume: candidate %s not found — skipping", candidate_id
            )
            return

        job_id = candidate.job_id

        try:
            file_bytes, suffix = _load_resume_bytes(candidate)
            text = extract_text_from_bytes(
                file_bytes, _filename_for_extract(candidate, suffix)
            )
        except UnsupportedDocumentError as exc:
            logger.warning(
                "parse_resume: unsupported document for candidate %s — %s",
                candidate_id,
                exc,
            )
            candidate.parse_status = "parse_failed"
            candidate.parse_started_at = None
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            return
        except Exception as exc:
            logger.warning(
                "parse_resume: candidate %s re-extract failed: %s",
                candidate_id,
                exc,
            )
            candidate.parse_status = "parse_failed"
            candidate.parse_started_at = None
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            return

        if not text:
            logger.warning(
                "parse_resume: candidate %s has empty resume text — marking failed",
                candidate_id,
            )
            candidate.parse_status = "parse_failed"
            candidate.parse_started_at = None
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            return

        try:
            job_result = await session.execute(
                select(Job).where(Job.id == job_id)
            )
            job = job_result.scalar_one_or_none()
            if not job:
                logger.error("parse_resume: job %s not found for candidate %s", job_id, candidate_id)
                candidate.parse_status = "parse_failed"
                candidate.parse_started_at = None
                await session.commit()
                await dispatch_parse_slots(session, job_id)
                return

            integrations = await load_tenant_integrations(session, job.tenant_id)
            integrations.require("openai_api_key")

            parsed_data = await parse_resume_service(text, integrations.openai_api_key)

            candidate.parsed_data = parsed_data
            candidate.parse_status = "ready"
            candidate.parse_started_at = None

            if parsed_data.get("name"):
                candidate.name = parsed_data["name"]
            if parsed_data.get("email") and candidate.email.endswith("@upload.pending"):
                candidate.email = parsed_data["email"]
            if parsed_data.get("phone") and not candidate.phone:
                candidate.phone = parsed_data["phone"]

            await session.commit()
            skills = (parsed_data or {}).get("skills") or []
            logger.debug(
                "Finished parsing resume for %s — ready for shortlisting%s",
                candidate.name or "a candidate",
                " with skills noted" if skills else "",
            )
            await dispatch_parse_slots(session, job_id)

        except openai.AuthenticationError as exc:
            logger.error(
                "OpenAI API key invalid or missing — cannot parse resume for candidate %s: %s",
                candidate_id,
                exc,
            )
            candidate.parse_status = "parse_failed"
            candidate.parse_started_at = None
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            return

        except openai.RateLimitError as exc:
            logger.warning(
                "OpenAI rate limit hit for candidate %s — will retry: %s", candidate_id, exc
            )
            raise parse_resume.retry(
                exc=exc, countdown=config.celery.rate_limit_countdown_sec
            )

        except openai.APIConnectionError as exc:
            logger.warning(
                "OpenAI connection error for candidate %s — will retry: %s", candidate_id, exc
            )
            raise parse_resume.retry(
                exc=exc, countdown=config.celery.transient_countdown_sec
            )

        except Exception as exc:
            logger.error(
                "Unexpected error parsing resume for candidate %s: %s", candidate_id, exc
            )
            raise parse_resume.retry(
                exc=exc, countdown=config.celery.transient_countdown_sec
            )


@celery_app.task(name="tasks.recover_stuck_resume_parses")
def recover_stuck_resume_parses():
    """Periodic recovery for resumes stuck in parse_queued/parsing after a worker crash."""
    try:
        asyncio.run(_async_recover_stuck_parses())
    except Exception as exc:
        logger.error("recover_stuck_resume_parses failed: %s", exc)


async def _async_recover_stuck_parses() -> None:
    from app.services.parse_queue_service import recover_stuck_parses

    async with get_celery_db() as session:
        recovered = await recover_stuck_parses(session)
        if recovered:
            logger.info("recover_stuck_resume_parses: recovered %d candidates", recovered)
