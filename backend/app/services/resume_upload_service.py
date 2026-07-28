"""Resume upload orchestration."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Literal

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config_loader import config
from app.core.logging import get_actor_label, log_event, plural
from app.core.tenancy import get_tenant_job
from app.exceptions import UploadDirectoryError
from app.models.models import Candidate, User
from app.repositories.candidate_repository import CandidateRepository
from app.schemas.schemas import ResumeUploadResponse
from app.services.audit_service import AuditService
from app.services.processing_queue_service import ProcessingQueueService
from app.services.resume_document_service import ResumeDocumentService
from app.services.resume_storage_service import ResumeStorageService

logger = logging.getLogger(__name__)


class ResumeUploadService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        candidate_repo: CandidateRepository | None = None,
        documents: ResumeDocumentService | None = None,
        storage: ResumeStorageService | None = None,
        audit_service: AuditService | None = None,
        queue_service: ProcessingQueueService | None = None,
    ) -> None:
        self._session = session
        self._candidates = candidate_repo or CandidateRepository(session)
        self._documents = documents or ResumeDocumentService()
        self._storage = storage or ResumeStorageService()
        self._audit = audit_service or AuditService(session)
        self._queue = queue_service or ProcessingQueueService(session)

    async def upload(
        self,
        actor: User,
        job_id: uuid.UUID,
        files: list[UploadFile],
    ) -> ResumeUploadResponse:
        for upload_file in files:
            self._documents.validate_upload(upload_file)

        job = await get_tenant_job(self._session, job_id, actor.tenant_id)
        upload_dir = self._ensure_upload_dir(actor.tenant_id, job_id)

        created_ids: list[str] = []
        skipped: list[str] = []
        skipped_oversized: list[str] = []
        extracted_from_zip = 0

        for upload_file in files:
            content = await upload_file.read()
            if self._documents.is_zip_file(upload_file):
                self._documents.validate_zip_size(content, upload_file.filename or "archive.zip")
                extracted = await self._documents.extract_zip_members(content)
                extracted_from_zip += len(extracted)
                for member_name, member_content in extracted:
                    outcome, detail = await self._ingest_single_resume(
                        job_id,
                        actor.tenant_id,
                        member_name,
                        member_content,
                        upload_dir,
                    )
                    self._collect_outcome(
                        outcome, detail, created_ids, skipped, skipped_oversized
                    )
                continue

            filename = upload_file.filename or f"{uuid.uuid4()}.pdf"
            self._documents.validate_resume_size(content, filename)
            outcome, detail = await self._ingest_single_resume(
                job_id,
                actor.tenant_id,
                filename,
                content,
                upload_dir,
            )
            self._collect_outcome(outcome, detail, created_ids, skipped, skipped_oversized)

        for candidate_id in created_ids:
            candidate = await self._candidates.get_by_id(uuid.UUID(candidate_id))
            if candidate:
                await self._audit.log_change(
                    actor=actor,
                    action="candidate.uploaded",
                    entity_type="candidate",
                    entity_id=candidate.id,
                    subject_label=candidate.original_filename or candidate.name or candidate_id,
                    feature="resume",
                    before=None,
                    after={"original_filename": candidate.original_filename},
                    job_id=job_id,
                    candidate_id=candidate.id,
                )

        await self._session.commit()
        await self._queue.dispatch_slots(job_id)

        log_event(
            logger,
            "%s uploaded %s for job \"%s\"%s%s%s",
            get_actor_label(),
            plural(len(created_ids), "resume"),
            job.title,
            f", skipped {plural(len(skipped), 'duplicate')}" if skipped else "",
            f", skipped {plural(skipped_oversized, 'oversized file')}" if skipped_oversized else "",
            ", including files from a zip archive" if extracted_from_zip else "",
        )
        if created_ids:
            logger.debug(
                "Accepted resume uploads for job \"%s\": %s",
                job.title,
                ", ".join(created_ids),
            )

        worker_warning = await self._worker_warning_if_needed(created_ids)
        return ResumeUploadResponse(
            created=len(created_ids),
            skipped=len(skipped),
            skipped_files=skipped,
            candidate_ids=created_ids,
            extracted_from_zip=extracted_from_zip,
            skipped_oversized=skipped_oversized,
            worker_warning=worker_warning,
        )

    def _ensure_upload_dir(self, tenant_id: uuid.UUID, job_id: uuid.UUID) -> Path:
        upload_dir = Path(config.UPLOAD_DIR) / str(tenant_id) / str(job_id)
        try:
            upload_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.error("Failed to create upload directory %s: %s", upload_dir, exc)
            raise UploadDirectoryError() from exc
        return upload_dir

    async def _ingest_single_resume(
        self,
        job_id: uuid.UUID,
        tenant_id: uuid.UUID,
        filename: str,
        content: bytes,
        upload_dir: Path,
    ) -> tuple[Literal["created", "skipped", "oversized"], str | None]:
        if self._documents.is_resume_oversized(content):
            return "oversized", Path(filename).name

        filename = Path(filename).name
        existing = await self._candidates.find_by_filename(job_id, filename)
        if existing:
            logger.debug("Skipping a duplicate resume upload named %s", filename)
            return "skipped", filename

        stored_path = await self._storage.store_resume(
            tenant_id,
            job_id,
            filename,
            content,
            upload_dir=upload_dir,
        )
        candidate = Candidate(
            job_id=job_id,
            name=Path(filename).stem,
            email=f"pending_{uuid.uuid4().hex}@upload.pending",
            resume_file_path=stored_path,
            original_filename=filename,
            pipeline_status="queued",
        )
        self._candidates.add(candidate)
        await self._candidates.flush()
        return "created", str(candidate.id)

    @staticmethod
    def _collect_outcome(
        outcome: Literal["created", "skipped", "oversized"],
        detail: str | None,
        created_ids: list[str],
        skipped: list[str],
        skipped_oversized: list[str],
    ) -> None:
        if outcome == "created" and detail:
            created_ids.append(detail)
        elif outcome == "skipped" and detail:
            skipped.append(detail)
        elif outcome == "oversized" and detail:
            skipped_oversized.append(detail)

    @staticmethod
    async def _worker_warning_if_needed(created_ids: list[str]) -> str | None:
        if not created_ids:
            return None
        from app.core.celery_queues import RESUME_QUEUE
        from app.services.celery_health import (
            CELERY_RESUME_UNAVAILABLE_MSG,
            celery_queue_available_async,
        )

        if not await celery_queue_available_async(RESUME_QUEUE):
            logger.warning(CELERY_RESUME_UNAVAILABLE_MSG)
            return CELERY_RESUME_UNAVAILABLE_MSG
        return None
