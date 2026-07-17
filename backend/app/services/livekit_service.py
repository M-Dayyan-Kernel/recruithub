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

from app.core.config_loader import config

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


def _s3_configured() -> bool:
    return bool(
        config.S3_BUCKET
        and config.S3_ACCESS_KEY
        and config.S3_SECRET_KEY
        and config.S3_ENDPOINT
    )


async def create_room(
    room_name: str,
    integrations: "TenantIntegrations",
) -> tuple[str, str | None, str | None]:
    """
    Create a LiveKit room, dispatch the AI agent, and start egress recording.

    Returns (room_name, egress_id, recording_key). egress_id / recording_key
    are None if recording could not be started (e.g. egress not configured).
    """
    from app.services.mock_external import mock_livekit_enabled, log_mock_usage

    if mock_livekit_enabled():
        log_mock_usage("livekit", f"create_room({room_name})")
        return room_name, None, None

    from livekit import api

    livekit_url, api_key, api_secret = _livekit_credentials(integrations)
    lk = config.livekit

    lkapi = api.LiveKitAPI(
        url=_livekit_http_url(livekit_url),
        api_key=api_key,
        api_secret=api_secret,
    )

    try:
        room = await lkapi.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                empty_timeout=lk.room.empty_timeout_seconds,
                max_participants=lk.room.max_participants,
            )
        )
        logger.info("LiveKit room created: %s", room.name)

        # Explicitly dispatch the AI agent worker into this room
        try:
            dispatch = await lkapi.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(
                    room=room_name,
                    agent_name=lk.agent_name,
                )
            )
            logger.info("Agent dispatched to room %s: dispatch_id=%s", room_name, dispatch.id)
        except Exception as exc:
            logger.warning("Agent dispatch failed (agent may auto-join): %s", exc)

        # Start composite egress recording for the room.
        # When S3_* is configured, upload to Linode Object Storage (S3-compatible).
        # Otherwise attempt egress without an explicit s3 target (LiveKit project default).
        egress_id: str | None = None
        recording_key: str | None = None
        prefix = lk.recording.key_prefix.rstrip("/")
        filepath = f"{prefix}/interview-{room_name}.mp4"
        try:
            file_output_kwargs: dict = {
                "file_type": api.EncodedFileType.MP4,
                "filepath": filepath,
            }
            if _s3_configured():
                file_output_kwargs["s3"] = api.S3Upload(
                    access_key=config.S3_ACCESS_KEY,
                    secret=config.S3_SECRET_KEY,
                    region=config.S3_REGION,
                    endpoint=config.S3_ENDPOINT,
                    bucket=config.S3_BUCKET,
                    force_path_style=config.S3_FORCE_PATH_STYLE,
                )
            else:
                logger.warning(
                    "S3 storage not fully configured — starting egress without "
                    "explicit Linode upload target (set S3_BUCKET/S3_ACCESS_KEY/"
                    "S3_SECRET_KEY/S3_ENDPOINT)"
                )

            egress = await lkapi.egress.start_room_composite_egress(
                api.RoomCompositeEgressRequest(
                    room_name=room_name,
                    layout=lk.recording.layout,
                    file_outputs=[api.EncodedFileOutput(**file_output_kwargs)],
                )
            )
            egress_id = egress.egress_id
            recording_key = filepath
            logger.info(
                "Recording started for room %s: egress_id=%s recording_key=%s",
                room_name,
                egress_id,
                recording_key,
            )
        except Exception as exc:
            logger.warning(
                "Could not start recording for room %s "
                "(egress/storage may not be configured on this LiveKit project): %s",
                room_name, exc,
            )

        return room.name, egress_id, recording_key
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
    ttl_hours = config.livekit.room.token_ttl_hours

    token = (
        AccessToken(
            api_key=api_key,
            api_secret=api_secret,
        )
        .with_identity(f"candidate-{candidate_name.replace(' ', '-').lower()}")
        .with_name(candidate_name)
        .with_ttl(timedelta(hours=ttl_hours))
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
    ttl_hours = config.livekit.room.token_ttl_hours

    token = (
        AccessToken(
            api_key=api_key,
            api_secret=api_secret,
        )
        .with_identity("ai-interviewer-agent")
        .with_name("AI Interviewer")
        .with_ttl(timedelta(hours=ttl_hours))
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
