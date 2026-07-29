"""External API clients — transport layer for third-party integrations."""

from __future__ import annotations

from functools import lru_cache

from app.clients.gmail_client import GmailClient, GmailNotConfiguredError
from app.clients.livekit_client import LiveKitClient
from app.clients.openai_client import OpenAIClient
from app.clients.s3_client import S3Client
from app.clients.vapi_client import VapiClient

__all__ = [
    "GmailClient",
    "GmailNotConfiguredError",
    "LiveKitClient",
    "OpenAIClient",
    "S3Client",
    "VapiClient",
    "get_gmail_client",
    "get_livekit_client",
    "get_openai_client",
    "get_s3_client",
    "get_vapi_client",
    "gmail_client",
    "livekit_client",
    "openai_client",
    "s3_client",
    "vapi_client",
]


@lru_cache
def get_openai_client() -> OpenAIClient:
    return OpenAIClient()


@lru_cache
def get_vapi_client() -> VapiClient:
    return VapiClient()


@lru_cache
def get_livekit_client() -> LiveKitClient:
    return LiveKitClient()


@lru_cache
def get_s3_client() -> S3Client:
    return S3Client()


@lru_cache
def get_gmail_client() -> GmailClient:
    return GmailClient()


def openai_client() -> OpenAIClient:
    return get_openai_client()


def vapi_client() -> VapiClient:
    return get_vapi_client()


def livekit_client() -> LiveKitClient:
    return get_livekit_client()


def s3_client() -> S3Client:
    return get_s3_client()


def gmail_client() -> GmailClient:
    return get_gmail_client()
