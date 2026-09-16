"""HTTP client for the external video proctoring (analyze) API."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.core.config_loader import config

logger = logging.getLogger(__name__)


class VideoProctoringError(Exception):
    """Non-retryable or transport failure talking to the proctoring API."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class VideoProctoringClient:
    """Calls VIDEO_PROCTORING_URL base: POST /api/v1/analyze, GET /api/v1/jobs/{id}."""

    def __init__(self, base_url: str | None = None, *, timeout: float = 30.0) -> None:
        self._base_url = (
            base_url if base_url is not None else config.VIDEO_PROCTORING_URL or ""
        ).rstrip("/")
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self._base_url)

    def _analyze_url(self) -> str:
        return f"{self._base_url}/api/v1/analyze"

    def _job_url(self, job_id: str) -> str:
        return f"{self._base_url}/api/v1/jobs/{job_id}"

    def submit_analyze_sync(self, video_key: str, idempotency_key: str) -> dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
        }
        with httpx.Client(timeout=self._timeout) as client:
            response = client.post(
                self._analyze_url(),
                json={"video_key": video_key},
                headers=headers,
            )
        if response.status_code == 202:
            data = response.json()
            if not data.get("job_id"):
                raise VideoProctoringError(
                    f"Analyze response missing job_id: {data!r}",
                    status_code=response.status_code,
                )
            return data
        detail = _response_detail(response)
        raise VideoProctoringError(
            f"Analyze failed ({response.status_code}): {detail}",
            status_code=response.status_code,
        )

    async def submit_analyze(self, video_key: str, idempotency_key: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            self.submit_analyze_sync, video_key, idempotency_key
        )

    def get_job_sync(self, job_id: str) -> dict[str, Any]:
        with httpx.Client(timeout=self._timeout) as client:
            response = client.get(self._job_url(job_id))
        if response.status_code == 200:
            return response.json()
        detail = _response_detail(response)
        raise VideoProctoringError(
            f"Get job failed ({response.status_code}): {detail}",
            status_code=response.status_code,
        )

    async def get_job(self, job_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(self.get_job_sync, job_id)


def _response_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict) and body.get("detail") is not None:
            return str(body["detail"])
    except Exception:
        pass
    return (response.text or "")[:500]
