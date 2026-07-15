import asyncio
import logging
import uuid
from pathlib import Path

import fitz  # pymupdf
import docx  # python-docx
from sqlalchemy import select

from app.core.celery_app import celery_app
from app.core.database import get_celery_db
from app.models.models import Candidate
from app.services.parse_queue_service import dispatch_parse_slots

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Task 3.3 — Raw text extraction (Forge)
# ---------------------------------------------------------------------------

@celery_app.task(name="tasks.extract_resume_text", bind=True, max_retries=3)
def extract_resume_text(self, candidate_id: str):
    """Extract raw text from an uploaded resume (PDF or DOCX) and save it to the DB.

    File-not-found: marks parse_failed immediately, does NOT retry (file won't appear by itself).
    Other failures: retries up to 3 times with 60-second countdown.
    On success: chains to parse_resume (Sage's task).
    """
    try:
        asyncio.run(_async_extract(self, candidate_id))
    except _NoRetryError:
        # File system error — already logged + DB updated; don't retry
        pass
    except Exception as exc:
        logger.error("extract_resume_text failed for candidate %s: %s", candidate_id, exc)
        raise self.retry(exc=exc, countdown=60)


class _NoRetryError(Exception):
    """Sentinel to abort retry on unrecoverable errors (e.g. missing file)."""


async def _async_extract(task_self, candidate_id: str) -> None:
    async with get_celery_db() as session:
        result = await session.execute(
            select(Candidate).where(Candidate.id == uuid.UUID(candidate_id))
        )
        candidate = result.scalar_one_or_none()

        # Fallback 5: candidate not in DB — log and return early, no raise
        if not candidate:
            logger.warning(
                "extract_resume_text: candidate %s not found in DB — skipping", candidate_id
            )
            return

        job_id = candidate.job_id

        # Allow resume when a previous worker died mid-extraction (status left as parsing).
        if candidate.parse_status not in ("parse_queued", "pending_parse", "parsing"):
            logger.info(
                "extract_resume_text: candidate %s not queued (status=%s) — skipping",
                candidate_id,
                candidate.parse_status,
            )
            return

        candidate.parse_status = "parsing"
        await session.commit()

        try:
            file_path = Path(candidate.resume_file_path or "")

            # Fallback 2: file does not exist — no retry
            if not file_path.exists():
                logger.error(
                    "extract_resume_text: file not found for candidate %s — path: %s",
                    candidate_id,
                    file_path,
                )
                candidate.parse_status = "parse_failed"
                await session.commit()
                await dispatch_parse_slots(session, job_id)
                raise _NoRetryError(f"File not found: {file_path}")

            suffix = file_path.suffix.lower()

            if suffix == ".pdf":
                doc = fitz.open(str(file_path))
                text = "\n".join(page.get_text() for page in doc)
                doc.close()
            elif suffix in (".docx", ".doc"):
                document = docx.Document(str(file_path))
                text = "\n".join(p.text for p in document.paragraphs if p.text.strip())
            else:
                raise ValueError(f"Unsupported file type: {suffix!r}")

            candidate.resume_raw_text = text.strip()
            await session.commit()
            logger.info(
                "Extracted text from resume for candidate %s (%d chars)",
                candidate_id,
                len(text),
            )

            # Chain to parse_resume (Sage's task)
            parse_resume.apply_async(args=[candidate_id])

        except _NoRetryError:
            raise  # propagate to outer handler without further DB writes

        except Exception as exc:
            logger.error(
                "Text extraction failed for candidate %s: %s", candidate_id, exc
            )
            candidate.parse_status = "parse_failed"
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            raise


# ==========================================================================
# Tasks 3.5 / 3.6 — parse + embed tasks
# ==========================================================================

@celery_app.task(name="tasks.parse_resume", bind=True, max_retries=3)
def parse_resume(self, candidate_id: str):
    """Parse extracted resume text with GPT-4o into structured fields.

    Sets parse_status → 'parsed' on success, chains to embedding task.
    Handles OpenAI auth/rate/connection errors with appropriate retry behaviour.
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

        # Fallback 5: candidate not found — return early
        if not candidate:
            logger.warning(
                "parse_resume: candidate %s not found — skipping", candidate_id
            )
            return

        job_id = candidate.job_id

        if not candidate.resume_raw_text:
            logger.warning(
                "parse_resume: candidate %s has no raw text — marking failed", candidate_id
            )
            candidate.parse_status = "parse_failed"
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
                await session.commit()
                await dispatch_parse_slots(session, job_id)
                return

            integrations = await load_tenant_integrations(session, job.tenant_id)
            integrations.require("openai_api_key")

            parsed_data = await parse_resume_service(
                candidate.resume_raw_text, integrations.openai_api_key
            )

            candidate.parsed_data = parsed_data
            candidate.parse_status = "parsed"

            # Back-fill contact fields — only if still placeholder / empty
            if parsed_data.get("name"):
                candidate.name = parsed_data["name"]
            if parsed_data.get("email") and candidate.email.endswith("@upload.pending"):
                candidate.email = parsed_data["email"]
            if parsed_data.get("phone") and not candidate.phone:
                candidate.phone = parsed_data["phone"]

            await session.commit()
            logger.info("Parsed resume for candidate %s", candidate_id)

            # Chain to embedding generation
            generate_candidate_embedding.apply_async(args=[candidate_id])

        except openai.AuthenticationError as exc:
            logger.error(
                "OpenAI API key invalid or missing — cannot parse resume for candidate %s: %s",
                candidate_id,
                exc,
            )
            candidate.parse_status = "parse_failed"
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            return  # Do not retry — bad key won't fix itself

        except openai.RateLimitError as exc:
            logger.warning(
                "OpenAI rate limit hit for candidate %s — will retry: %s", candidate_id, exc
            )
            raise parse_resume.retry(exc=exc, countdown=300)

        except openai.APIConnectionError as exc:
            logger.warning(
                "OpenAI connection error for candidate %s — will retry: %s", candidate_id, exc
            )
            raise parse_resume.retry(exc=exc, countdown=120)

        except Exception as exc:
            logger.error(
                "Unexpected error parsing resume for candidate %s: %s", candidate_id, exc
            )
            raise parse_resume.retry(exc=exc, countdown=120)


@celery_app.task(name="tasks.generate_candidate_embedding", bind=True, max_retries=3)
def generate_candidate_embedding(self, candidate_id: str):
    """Generate text-embedding-3-small embedding and store in pgvector.

    Sets parse_status → 'ready' on success.
    Handles OpenAI auth/rate/connection errors with appropriate retry behaviour.
    """
    try:
        asyncio.run(_async_embed(candidate_id))
    except Exception as exc:
        logger.error(
            "generate_candidate_embedding failed for candidate %s: %s", candidate_id, exc
        )
        raise


async def _async_embed(candidate_id: str) -> None:
    import openai  # local import

    from app.models.models import Job
    from app.services.embedding_service import generate_embedding
    from app.services.tenant_integrations_service import load_tenant_integrations

    async with get_celery_db() as session:
        result = await session.execute(
            select(Candidate).where(Candidate.id == uuid.UUID(candidate_id))
        )
        candidate = result.scalar_one_or_none()

        # Fallback 5: candidate not found — return early
        if not candidate:
            logger.warning(
                "generate_candidate_embedding: candidate %s not found — skipping",
                candidate_id,
            )
            return

        job_id = candidate.job_id

        if not candidate.resume_raw_text:
            logger.warning(
                "generate_candidate_embedding: candidate %s has no raw text — marking failed",
                candidate_id,
            )
            candidate.parse_status = "parse_failed"
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            return

        try:
            job_result = await session.execute(
                select(Job).where(Job.id == job_id)
            )
            job = job_result.scalar_one_or_none()
            if not job:
                logger.error(
                    "generate_candidate_embedding: job %s not found for candidate %s",
                    job_id,
                    candidate_id,
                )
                candidate.parse_status = "parse_failed"
                await session.commit()
                await dispatch_parse_slots(session, job_id)
                return

            integrations = await load_tenant_integrations(session, job.tenant_id)
            integrations.require("openai_api_key")

            embedding = await generate_embedding(
                candidate.resume_raw_text, integrations.openai_api_key
            )
            candidate.resume_embedding = embedding
            candidate.parse_status = "ready"
            await session.commit()
            logger.info(
                "Generated embedding for candidate %s (%d dims)",
                candidate_id,
                len(embedding),
            )
            await dispatch_parse_slots(session, job_id)

        except openai.AuthenticationError as exc:
            logger.error(
                "OpenAI API key invalid or missing — cannot embed candidate %s: %s",
                candidate_id,
                exc,
            )
            candidate.parse_status = "parse_failed"
            await session.commit()
            await dispatch_parse_slots(session, job_id)
            return

        except openai.RateLimitError as exc:
            logger.warning(
                "OpenAI rate limit hit for candidate %s embedding — will retry: %s",
                candidate_id,
                exc,
            )
            raise generate_candidate_embedding.retry(exc=exc, countdown=300)

        except openai.APIConnectionError as exc:
            logger.warning(
                "OpenAI connection error for candidate %s embedding — will retry: %s",
                candidate_id,
                exc,
            )
            raise generate_candidate_embedding.retry(exc=exc, countdown=120)

        except Exception as exc:
            logger.error(
                "Unexpected error generating embedding for candidate %s: %s",
                candidate_id,
                exc,
            )
            raise generate_candidate_embedding.retry(exc=exc, countdown=120)


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
