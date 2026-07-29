"""
LiveKit Service — thin facade over LiveKitClient.

Creates LiveKit rooms and generates participant access tokens via the livekit-api SDK.
"""

from typing import TYPE_CHECKING

from app.clients import livekit_client

if TYPE_CHECKING:
    from app.services.tenant_integrations_service import TenantIntegrations


async def create_room(
    room_name: str,
    integrations: "TenantIntegrations",
) -> tuple[str, str | None, str | None]:
    return await livekit_client().create_room(room_name, integrations)


def generate_candidate_token(
    room_name: str,
    candidate_name: str,
    integrations: "TenantIntegrations",
) -> str:
    return livekit_client().generate_candidate_token(
        room_name, candidate_name, integrations
    )


def generate_agent_token(
    room_name: str,
    integrations: "TenantIntegrations",
) -> str:
    return livekit_client().generate_agent_token(room_name, integrations)
