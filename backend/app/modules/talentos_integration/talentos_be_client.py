from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from app.core.settings import settings

logger = logging.getLogger(__name__)


async def get_talentos_client_for_tenant(tenant_id: Optional[Any] = None) -> "TalentosBEClient":
    """Build a TalentosBEClient using per-tenant overrides, falling back to .env.

    A missing/None tenant_id always yields the plain .env-backed client so the
    behavior is identical to the previous ``TalentosBEClient()``.
    """
    if tenant_id is None:
        return TalentosBEClient()
    try:
        from app.core.database import get_celery_db

        async with get_celery_db() as db:
            from app.modules.talentos_integration.tenant_connection import (
                load_tenant_connection,
            )

            data = await load_tenant_connection(db, tenant_id)
        values = data["values"]
        return TalentosBEClient(
            base_url=values.get("talentos_be_url") or None,
            api_key=values.get("talentos_be_api_key") or None,
        )
    except Exception:
        logger.warning(
            "Failed to load tenant connection overrides for tenant_id=%s; falling back to .env",
            tenant_id,
            exc_info=True,
        )
        return TalentosBEClient()


class TalentosBEClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> None:
        self._base_url = (base_url or settings.TALENTOS_BE_URL).rstrip("/")
        self._api_key = api_key or settings.TALENTOS_BE_API_KEY
        self._headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
        }

    async def get_hiring_request(self, external_job_id: str) -> Optional[dict[str, Any]]:
        url = f"{self._base_url}/internal/hiring-requests/{external_job_id}"
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url, headers=self._headers, timeout=30.0)
                if resp.status_code == 404:
                    logger.warning("Hiring request %s not found on talentOS BE", external_job_id)
                    return None
                resp.raise_for_status()
                data = resp.json()
                return data
            except httpx.HTTPError as exc:
                logger.error("Failed to fetch hiring request %s: %s", external_job_id, exc)
                return None

    async def _post(self, path: str, body: dict[str, Any]) -> Optional[dict[str, Any]]:
        url = f"{self._base_url}{path}"
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(url, json=body, headers=self._headers, timeout=30.0)
                if resp.is_error:
                    logger.error(
                        "talentOS BE POST %s failed: status=%s body=%s",
                        path, resp.status_code, resp.text[:500],
                    )
                    return None
                return resp.json() if resp.content else None
            except httpx.HTTPError as exc:
                logger.error("talentOS BE POST %s transport error: %s", path, exc)
                return None

    async def push_screening_completion(
        self,
        *,
        external_job_id: Optional[str],
        external_candidate_id: Optional[str],
        screening_call_id: Optional[str],
        result: dict[str, Any],
    ) -> Optional[dict[str, Any]]:
        if not external_job_id or not external_candidate_id:
            logger.info(
                "push_screening_completion skipped: missing external ids (job=%s candidate=%s)",
                external_job_id, external_candidate_id,
            )
            return None
        return await self._post(
            "/internal/talentos/webhooks/screening",
            {
                "external_job_id": external_job_id,
                "external_candidate_id": external_candidate_id,
                "screening_call_id": screening_call_id,
                "result": result,
            },
        )

    async def push_interview_completion(
        self,
        *,
        external_job_id: Optional[str],
        external_candidate_id: Optional[str],
        interview_id: Optional[str],
        result: dict[str, Any],
        status: Optional[str] = None,
        flag_reason: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        if not external_job_id or not external_candidate_id:
            logger.info(
                "push_interview_completion skipped: missing external ids (job=%s candidate=%s)",
                external_job_id, external_candidate_id,
            )
            return None
        body: dict[str, Any] = {
            "external_job_id": external_job_id,
            "external_candidate_id": external_candidate_id,
            "interview_id": interview_id,
            "result": result,
        }
        if status:
            body["status"] = status
        if flag_reason:
            body["flag_reason"] = flag_reason
        return await self._post("/internal/talentos/webhooks/interview", body)
