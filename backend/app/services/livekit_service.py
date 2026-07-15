"""
LiveKit Service — Sprint 6

Creates LiveKit rooms and generates participant access tokens via the livekit-api SDK.

Functions:
  - create_room(room_name, integrations): Creates a LiveKit room via REST API
  - generate_candidate_token(room_name, candidate_name, integrations): JWT token for candidate
  - generate_agent_token(room_name, integrations): JWT token for AI agent participant
"""

import logging
from datetime import timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.tenant_integrations_service import TenantIntegrations

logger = logging.getLogger(__name__)


def _livekit_http_url(livekit_url: str) -> str:
    """REST API expects https:// — candidates still use wss:// in LIVEKIT_URL."""
    url = livekit_url.rstrip("/")
    return url.replace("wss://", "https://").replace("ws://", "http://")


def _livekit_credentials(integrations: "TenantIntegrations") -> tuple[str, str, str]:
    integrations.require("livekit_url", "livekit_api_key", "livekit_api_secret")
    return (
        integrations.livekit_url,
        integrations.livekit_api_key,
        integrations.livekit_api_secret,
    )


async def create_room(
    room_name: str,
    integrations: "TenantIntegrations",
) -> tuple[str, str | None]:
    """
    Create a LiveKit room, dispatch the AI agent, and start egress recording.

    Returns (room_name, egress_id). egress_id is None if recording could not
    be started (e.g. egress not configured on this LiveKit project).
    """
    from app.services.mock_external import mock_livekit_enabled, log_mock_usage

    if mock_livekit_enabled():
        log_mock_usage("livekit", f"create_room({room_name})")
        return room_name, None

    from livekit import api

    livekit_url, api_key, api_secret = _livekit_credentials(integrations)

    lkapi = api.LiveKitAPI(
        url=_livekit_http_url(livekit_url),
        api_key=api_key,
        api_secret=api_secret,
    )

    try:
        room = await lkapi.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                empty_timeout=600,
                max_participants=10,
            )
        )
        logger.info("LiveKit room created: %s", room.name)

        # Explicitly dispatch the AI agent worker into this room
        try:
            dispatch = await lkapi.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(
                    room=room_name,
                    agent_name="interview-agent",
                )
            )
            logger.info("Agent dispatched to room %s: dispatch_id=%s", room_name, dispatch.id)
        except Exception as exc:
            logger.warning("Agent dispatch failed (agent may auto-join): %s", exc)

        # Start composite egress recording for the room.
        # Recordings are saved as MP4 in the configured S3/storage bucket.
        # This will fail gracefully if egress is not enabled on this LiveKit
        # Cloud project or no storage bucket is configured.
        egress_id: str | None = None
        try:
            egress = await lkapi.egress.start_room_composite_egress(
                api.RoomCompositeEgressRequest(
                    room_name=room_name,
                    layout="speaker",
                    file_outputs=[
                        api.EncodedFileOutput(
                            file_type=api.EncodedFileType.OGG,
                            filepath=f"recordings/interview-{room_name}.ogg",
                        )
                    ],
                )
            )
            egress_id = egress.egress_id
            logger.info("Recording started for room %s: egress_id=%s", room_name, egress_id)
        except Exception as exc:
            logger.warning(
                "Could not start recording for room %s "
                "(egress/storage may not be configured on this LiveKit project): %s",
                room_name, exc,
            )

        return room.name, egress_id
    finally:
        await lkapi.aclose()


def generate_candidate_token(
    room_name: str,
    candidate_name: str,
    integrations: "TenantIntegrations",
) -> str:
    """
    Generate a signed JWT access token for a candidate participant.

    The token grants publish+subscribe permissions for the given room.
    """
    from app.services.mock_external import mock_livekit_enabled, mock_livekit_token

    if mock_livekit_enabled():
        identity = f"candidate-{candidate_name.replace(' ', '-').lower()}"
        return mock_livekit_token(room_name, identity)

    from livekit.api import AccessToken, VideoGrants

    _, api_key, api_secret = _livekit_credentials(integrations)

    token = (
        AccessToken(
            api_key=api_key,
            api_secret=api_secret,
        )
        .with_identity(f"candidate-{candidate_name.replace(' ', '-').lower()}")
        .with_name(candidate_name)
        .with_ttl(timedelta(hours=2))
        .with_grants(
            VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
            )
        )
    )
    return token.to_jwt()


def generate_agent_token(
    room_name: str,
    integrations: "TenantIntegrations",
) -> str:
    """
    Generate a signed JWT access token for the AI agent participant.

    The agent gets publish+subscribe and room admin permissions.
    """
    from app.services.mock_external import mock_livekit_enabled, mock_livekit_token

    if mock_livekit_enabled():
        return mock_livekit_token(room_name, "ai-interviewer-agent")

    from livekit.api import AccessToken, VideoGrants

    _, api_key, api_secret = _livekit_credentials(integrations)

    token = (
        AccessToken(
            api_key=api_key,
            api_secret=api_secret,
        )
        .with_identity("ai-interviewer-agent")
        .with_name("AI Interviewer")
        .with_ttl(timedelta(hours=2))
        .with_grants(
            VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                room_admin=True,
            )
        )
    )
    return token.to_jwt()
