"""Vapi.ai REST API client."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any, Optional

import httpx

from app.clients import mocks
from app.core.config_loader import config

if TYPE_CHECKING:
    from app.services.tenant_integrations_service import TenantIntegrations

logger = logging.getLogger(__name__)


class VapiClient:
    """HTTP transport for Vapi outbound calls and status polling."""

    @staticmethod
    def _headers(api_key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def resolve_credentials(
        self,
        integrations: Optional["TenantIntegrations"] = None,
        *,
        api_key: str | None = None,
    ) -> tuple[str, str]:
        """Return (api_key, phone_number_id), preferring tenant integrations then platform .env."""
        key = (api_key or "").strip()
        phone_id = ""
        if integrations is not None:
            integrations.require("vapi_api_key", "vapi_phone_number_id")
            key = key or integrations.vapi_api_key
            phone_id = integrations.vapi_phone_number_id
        if not key:
            key = config.VAPI_API_KEY or ""
        if not phone_id:
            phone_id = config.VAPI_PHONE_NUMBER_ID or ""
        if not key:
            raise ValueError("VAPI API key is not configured")
        if not phone_id:
            raise ValueError("VAPI phone number ID is not configured")
        return key, phone_id

    def get_call_sync(self, vapi_call_id: str, timeout: float, api_key: str) -> dict:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                f"{config.vapi.api_base}/call/{vapi_call_id}",
                headers=self._headers(api_key),
            )
            if response.status_code != 200:
                raise Exception(
                    f"Vapi API error {response.status_code}: {response.text[:500]}"
                )
            return response.json()

    async def get_call(
        self,
        vapi_call_id: str,
        *,
        timeout: float | None = None,
        api_key: str | None = None,
        integrations: Optional["TenantIntegrations"] = None,
    ) -> dict:
        if mocks.mock_vapi_enabled():
            return mocks.mock_vapi_get_call(vapi_call_id)

        key, _ = self.resolve_credentials(integrations, api_key=api_key)
        resolved_timeout = (
            config.vapi.status_timeout_seconds if timeout is None else timeout
        )
        return await asyncio.to_thread(
            self.get_call_sync, vapi_call_id, resolved_timeout, key
        )

    def create_outbound_call_sync(self, payload: dict[str, Any], api_key: str) -> str:
        with httpx.Client(timeout=config.vapi.request_timeout_seconds) as client:
            response = client.post(
                f"{config.vapi.api_base}/call",
                json=payload,
                headers=self._headers(api_key),
            )
            if response.status_code not in (200, 201):
                raise Exception(
                    f"Vapi API error {response.status_code}: {response.text[:500]}"
                )
            data = response.json()

        vapi_call_id = data.get("id")
        if not vapi_call_id:
            raise Exception(f"Vapi response missing call ID. Response: {data}")
        return str(vapi_call_id)

    async def create_outbound_call(
        self,
        payload: dict[str, Any],
        *,
        api_key: str,
    ) -> str:
        return await asyncio.to_thread(
            self.create_outbound_call_sync, payload, api_key
        )
