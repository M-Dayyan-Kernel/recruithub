"""
Reference: a production-shaped service class.

Pattern to copy:
  - One class, one responsibility. Name is a noun phrase.
  - Dependencies injected via __init__ (never constructed inside, never global).
  - Methods appear in EXECUTION ORDER: retrieve -> parse -> load_prompt ->
    run_inference -> persist. Read top-to-bottom = read the pipeline.
  - One small public entry point (`shortlist`) orchestrates the ordered steps.
  - Pure logic (parse, score) is separable from I/O (retrieve, persist) so it
    can be unit-tested without a network.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .exceptions import ParseError, ResumeNotFoundError
from .schemas import ShortlistResult

logger = logging.getLogger(__name__)


# --- injected collaborators (protocols/clients defined elsewhere) -----------
# ResumeRepository: retrieve()/save() against DB or blob storage
# LLMClient:        complete() against the model provider, with timeout
# PromptLoader:     load() a versioned prompt template


@dataclass
class ParsedResume:
    """Pure data. No I/O, trivially constructable in a test."""
    candidate_id: str
    text: str
    skills: list[str]
    years_experience: float


class ResumeShortlistingService:
    """Scores a candidate's resume against a role. One responsibility."""

    def __init__(
        self,
        repository: "ResumeRepository",
        llm_client: "LLMClient",
        prompt_loader: "PromptLoader",
    ) -> None:
        self._repository = repository
        self._llm = llm_client
        self._prompts = prompt_loader

    # --- public entry point --------------------------------------------------
    async def shortlist(self, candidate_id: str, role_id: str) -> ShortlistResult:
        """Orchestrates the pipeline. This is the only method routers call."""
        raw = await self._retrieve_resume(candidate_id)
        parsed = self._parse_resume(candidate_id, raw)          # pure, sync
        prompt = self._load_prompt(role_id, parsed)             # pure, sync
        score = await self._run_inference(prompt)
        result = await self._persist_result(candidate_id, role_id, score)
        return result

    # --- pipeline steps, in the order they execute ---------------------------
    async def _retrieve_resume(self, candidate_id: str) -> bytes:
        raw = await self._repository.retrieve(candidate_id)
        if raw is None:
            raise ResumeNotFoundError(candidate_id)
        return raw

    def _parse_resume(self, candidate_id: str, raw: bytes) -> ParsedResume:
        # CPU-bound extraction lives here. If heavy, the CALLER offloads this
        # to a thread pool (see batch_processing.py) so it can't block the loop.
        try:
            text = _extract_text(raw)
        except Exception as exc:  # narrow this to the real parse errors
            raise ParseError(candidate_id, reason=str(exc)) from exc
        if not text.strip():
            raise ParseError(candidate_id, reason="empty document")
        return ParsedResume(
            candidate_id=candidate_id,
            text=text,
            skills=_extract_skills(text),
            years_experience=_extract_experience(text),
        )

    def _load_prompt(self, role_id: str, parsed: ParsedResume) -> str:
        template = self._prompts.load("shortlist", role_id)
        return template.format(
            resume=parsed.text,
            skills=", ".join(parsed.skills),
            years=parsed.years_experience,
        )

    async def _run_inference(self, prompt: str) -> float:
        response = await self._llm.complete(prompt)   # client owns the timeout
        return _score_from_response(response)

    async def _persist_result(
        self, candidate_id: str, role_id: str, score: float
    ) -> ShortlistResult:
        result = ShortlistResult(
            candidate_id=candidate_id, role_id=role_id, score=score
        )
        await self._repository.save_result(result)
        logger.info("shortlisted candidate=%s role=%s score=%.3f",
                    candidate_id, role_id, score)
        return result


# --- module-level pure helpers (no self, no I/O, unit-testable) -------------
def _extract_text(raw: bytes) -> str: ...
def _extract_skills(text: str) -> list[str]: ...
def _extract_experience(text: str) -> float: ...
def _score_from_response(response: str) -> float: ...
