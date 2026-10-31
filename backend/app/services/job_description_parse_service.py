"""Orchestrate JD file upload, extraction, and OpenAI parsing."""

from __future__ import annotations

import logging
import uuid

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import (
    EmptyJobDescriptionError,
    JobParseFailedError,
    JobParseUnavailableError,
    ValidationError,
)
from app.models.enums import SeniorityLevel
from app.schemas.schemas import InterviewTopicIn, JobParseResponse, ScreeningQuestion
from app.services.jd_parser_service import JdParserService
from app.services.job_document_service import JobDocumentService
from app.services.tenant_integrations_service import TenantIntegrationsService

logger = logging.getLogger(__name__)


def _parsed_seniority(raw: object) -> SeniorityLevel:
    """The model's suggestion, or mid-level when it is missing or not one of the four levels."""
    try:
        return SeniorityLevel(str(raw).strip().lower())
    except ValueError:
        return SeniorityLevel.MID


class JobDescriptionParseService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        document_service: JobDocumentService | None = None,
        parser: JdParserService | None = None,
        integrations_service: TenantIntegrationsService | None = None,
    ) -> None:
        self._session = session
        self._documents = document_service or JobDocumentService()
        self._parser = parser or JdParserService()
        self._integrations = integrations_service or TenantIntegrationsService(session)

    async def parse_upload(self, file: UploadFile, tenant_id: uuid.UUID) -> JobParseResponse:
        self._documents.validate_upload(file)
        content = await file.read()
        self._documents.validate_size(content)

        filename = file.filename or "upload.pdf"
        try:
            raw_text = await self._documents.extract_text(content, filename)
        except Exception as exc:
            if hasattr(exc, "response_content"):
                raise
            logger.exception("JD text extraction failed for %s", filename)
            raise ValidationError(
                public_message=f"Could not read file: {exc}",
            ) from exc

        if not raw_text:
            raise EmptyJobDescriptionError(
                public_message="No text could be extracted from the document.",
            )

        try:
            integrations = await self._integrations.load(tenant_id)
            integrations.require("openai_api_key")
            parsed = await self._parser.parse(raw_text, integrations.openai_api_key)
        except ValueError as exc:
            logger.warning("JD parse unavailable for tenant %s: %s", tenant_id, exc)
            raise JobParseUnavailableError(public_message=str(exc)) from exc
        except Exception as exc:
            if isinstance(exc, (JobParseUnavailableError, EmptyJobDescriptionError, ValidationError)):
                raise
            logger.exception("JD parse failed for tenant %s file %s", tenant_id, filename)
            raise JobParseFailedError(
                public_message=f"Failed to parse job description: {exc}",
            ) from exc

        if not (parsed.get("title") or "").strip() and not (parsed.get("description") or "").strip():
            raise ValidationError(
                public_message="Could not extract a job title or description from the document.",
            )

        return JobParseResponse(
            title=(parsed.get("title") or "").strip(),
            description=(parsed.get("description") or "").strip(),
            required_skills=parsed.get("required_skills") or [],
            seniority_level=_parsed_seniority(parsed.get("seniority_level")),
            work_mode=parsed.get("work_mode"),
            work_location=parsed.get("work_location"),
            screening_questions=[
                ScreeningQuestion(**q) for q in (parsed.get("screening_questions") or [])
            ],
            interview_topics=[
                InterviewTopicIn(**t) for t in (parsed.get("interview_topics") or [])
            ],
        )
