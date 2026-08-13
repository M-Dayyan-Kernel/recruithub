"""Hermetic unit tests for TalentosIntegrationService.ensure_job.

Covers the resolve-or-create guard that the talentOS integration module applies
before any operation: look up by external_job_id, then by job_id, then create
the job by pulling data back from talentOS (or 404 when impossible).
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.exceptions import NotFoundError
from app.models.models import Job, User
from app.modules.talentos_integration.talentos_integration_service import (
    DUMMY_JOB_UUID,
    TalentosIntegrationService,
)


def _actor() -> User:
    return User(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email="sys@example.com",
        full_name="System",
        hashed_password="x",
        role="admin",
        is_active=True,
    )


def _result_with(job) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = job
    return result


def _session_with(*results) -> AsyncMock:
    session = AsyncMock()
    session.add = MagicMock()
    if len(results) == 1:
        session.execute.return_value = results[0]
    else:
        session.execute.side_effect = list(results)
    return session


def _fake_client(hiring_data):
    client = MagicMock()
    client.get_hiring_request = AsyncMock(return_value=hiring_data)
    return client


@pytest.mark.asyncio
async def test_returns_existing_job_by_external_id():
    actor = _actor()
    existing = Job(
        id=uuid.uuid4(),
        title="T",
        description="",
        external_job_id="ext-1",
        tenant_id=actor.tenant_id,
        status="active",
    )
    session = _session_with(_result_with(existing))
    service = TalentosIntegrationService(session)

    job = await service.ensure_job(actor, DUMMY_JOB_UUID, "ext-1")

    assert job is existing
    session.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_returns_existing_job_by_job_id_when_external_unknown():
    actor = _actor()
    existing = Job(
        id=uuid.uuid4(),
        title="T",
        description="",
        external_job_id="ext-known",
        tenant_id=actor.tenant_id,
        status="active",
    )
    session = _session_with(_result_with(None), _result_with(existing))
    service = TalentosIntegrationService(session)

    job = await service.ensure_job(actor, existing.id, "ext-unknown")

    assert job is existing


@pytest.mark.asyncio
async def test_skips_dummy_job_id_lookup():
    actor = _actor()
    session = _session_with(_result_with(None), _result_with(None))
    with patch(
        "app.modules.talentos_integration.talentos_integration_service.get_talentos_client_for_tenant",
        new=AsyncMock(return_value=_fake_client({
            "title": "Fetched Title",
            "description": "Fetched description",
            "requirements": ["Python"],
        })),
    ):
        service = TalentosIntegrationService(session)
        job = await service.ensure_job(actor, DUMMY_JOB_UUID, "ext-new")

    assert job.external_job_id == "ext-new"
    assert job.tenant_id == actor.tenant_id
    assert job.title == "Fetched Title"
    session.add.assert_called()
    session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_creates_job_when_only_external_id_known():
    actor = _actor()
    # Executes: external lookup miss, job_id lookup miss, then resolve_or_create_job
    # internal lookup miss (job not yet present).
    session = _session_with(_result_with(None), _result_with(None), _result_with(None))
    with patch(
        "app.modules.talentos_integration.talentos_integration_service.get_talentos_client_for_tenant",
        new=AsyncMock(return_value=_fake_client({
            "title": "Backend Engineer",
            "description": "Build services",
            "requirements": ["Python", "FastAPI"],
        })),
    ):
        service = TalentosIntegrationService(session)
        job = await service.ensure_job(actor, uuid.uuid4(), "ext-9")

    assert job.external_job_id == "ext-9"
    assert job.title == "Backend Engineer"
    session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_raises_not_found_when_no_resolution_path():
    actor = _actor()
    session = _session_with(_result_with(None))
    service = TalentosIntegrationService(session)

    with pytest.raises(NotFoundError):
        await service.ensure_job(actor, uuid.uuid4(), None)


@pytest.mark.asyncio
async def test_raises_not_found_when_talentos_unreachable():
    actor = _actor()
    session = _session_with(_result_with(None), _result_with(None))
    with patch(
        "app.modules.talentos_integration.talentos_integration_service.get_talentos_client_for_tenant",
        new=AsyncMock(return_value=_fake_client(None)),
    ):
        service = TalentosIntegrationService(session)
        with pytest.raises(NotFoundError):
            await service.ensure_job(actor, DUMMY_JOB_UUID, "ext-missing")
