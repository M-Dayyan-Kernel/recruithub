from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from app.core.settings import settings

logger = logging.getLogger(__name__)


class TalentosBEClient:
    def __init__(self) -> None:
        self._base_url = settings.TALENTOS_BE_URL.rstrip("/")
        self._api_key = settings.TALENTOS_BE_API_KEY
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
