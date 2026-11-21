"""One resume attempt: stale tasks, the attempt cap, retry stamping and which errors retry."""

from __future__ import annotations

import json
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock

import openai

from app.exceptions import CandidateBeingReviewedError
from app.models.models import User
from app.services.candidate_service import CandidateService
from app.services.processing_queue_service import MAX_PROCESSING_ATTEMPTS
from app.services.resume_processing_service import (
    ProcessingOutcome,
    ResumeProcessingService,
)


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _Session:
    def __init__(self, candidate, job):
        self._results = [candidate, job]
        self.commit = mock.AsyncMock()
        self.rollback = mock.AsyncMock()
        self.refresh = mock.AsyncMock()

    async def execute(self, _query):
        return _Result(self._results.pop(0) if self._results else None)


def _candidate(**over):
    c = mock.Mock()
    c.id = uuid.uuid4()
    c.job_id = uuid.uuid4()
    c.pipeline_status = "processing"
    c.processing_token = "tok"
    c.processing_attempts = 0
    c.processing_retry_at = None
    c.name = "Asha"
    c.original_filename = "asha.pdf"
    for k, v in over.items():
        setattr(c, k, v)
    return c


def _rate_limit(body=None, message="Rate limit reached"):
    response = mock.Mock(status_code=429, headers={})
    return openai.RateLimitError(message, response=response, body=body)


class ProcessCandidateTests(unittest.IsolatedAsyncioTestCase):
    async def _run(self, candidate, *, raises=None, token="tok"):
        session = _Session(candidate, mock.Mock(tenant_id=uuid.uuid4()))
        combined = mock.Mock()
        combined.process = mock.AsyncMock(side_effect=raises)
        queue = mock.Mock(dispatch_slots=mock.AsyncMock())
        integrations = mock.Mock(openai_api_key="k")
        with mock.patch(
            "app.services.resume_processing_service.load_tenant_integrations",
            mock.AsyncMock(return_value=integrations),
        ):
            service = ResumeProcessingService(session, combined_shortlist=combined, queue_service=queue)
            result = await service.process_candidate(str(candidate.id), token)
        return result, combined

    async def test_a_stale_token_does_nothing(self):
        candidate = _candidate(processing_token="newer")
        result, combined = await self._run(candidate, token="older")
        self.assertEqual(result.outcome, ProcessingOutcome.SKIPPED)
        combined.process.assert_not_awaited()
        self.assertEqual(candidate.processing_attempts, 0)

    async def test_a_message_without_a_token_still_runs(self):
        result, _ = await self._run(_candidate(), token=None)
        self.assertEqual(result.outcome, ProcessingOutcome.COMPLETED)

    async def test_each_attempt_is_counted(self):
        candidate = _candidate(processing_attempts=1)
        await self._run(candidate)
        self.assertEqual(candidate.processing_attempts, 2)

    async def test_a_retry_stamps_when_it_is_due(self):
        candidate = _candidate()
        result, _ = await self._run(candidate, raises=openai.APIConnectionError(request=mock.Mock()))
        self.assertEqual(result.outcome, ProcessingOutcome.RETRY_CONNECTION)
        self.assertEqual(candidate.pipeline_status, "processing")
        self.assertGreater(candidate.processing_retry_at, datetime.now(timezone.utc))
        self.assertEqual(result.countdown, 120)

    async def test_a_malformed_ai_reply_is_retried_not_failed(self):
        for exc in (json.JSONDecodeError("bad", "{", 0),):
            candidate = _candidate()
            result, _ = await self._run(candidate, raises=exc)
            self.assertEqual(result.outcome, ProcessingOutcome.RETRY_TRANSIENT)
            self.assertEqual(candidate.pipeline_status, "processing")

    async def test_an_empty_ai_account_fails_at_once(self):
        candidate = _candidate()
        exc = _rate_limit(body={"code": "insufficient_quota"}, message="You exceeded your current quota")
        result, _ = await self._run(candidate, raises=exc)
        self.assertEqual(result.outcome, ProcessingOutcome.FAILED_NO_RETRY)
        self.assertEqual(candidate.pipeline_status, "failed")
        self.assertTrue(candidate.pipeline_error.startswith("insufficient_quota"))

    async def test_a_plain_rate_limit_waits_the_longer_countdown(self):
        result, _ = await self._run(_candidate(), raises=_rate_limit())
        self.assertEqual(result.outcome, ProcessingOutcome.RETRY_RATE_LIMIT)
        self.assertEqual(result.countdown, 300)

    async def test_the_last_attempt_fails_instead_of_retrying(self):
        candidate = _candidate(processing_attempts=MAX_PROCESSING_ATTEMPTS - 1)
        result, _ = await self._run(candidate, raises=RuntimeError("s3 down"))
        self.assertEqual(result.outcome, ProcessingOutcome.FAILED_NO_RETRY)
        self.assertEqual(candidate.pipeline_status, "failed")
        self.assertTrue(candidate.pipeline_error.startswith("Retries exhausted"))
        self.assertIsNone(candidate.processing_retry_at)

    async def test_a_duplicate_fails_without_retrying(self):
        candidate = _candidate()
        result, _ = await self._run(candidate, raises=ValueError("Duplicate candidate for job"))
        self.assertEqual(result.outcome, ProcessingOutcome.FAILED_NO_RETRY)


class RetryEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def _retry(self, candidate):
        actor = User(
            id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com", full_name="HR",
            hashed_password="x", role="hr", is_active=True,
        )
        service = CandidateService(
            mock.AsyncMock(), candidate_repo=mock.MagicMock(), audit_service=mock.AsyncMock(),
            storage=mock.MagicMock(), queue_service=mock.AsyncMock(),
        )
        with mock.patch("app.services.candidate_service.get_tenant_job", new_callable=mock.AsyncMock), \
                mock.patch("app.services.candidate_service.get_tenant_candidate",
                           new_callable=mock.AsyncMock, return_value=candidate):
            return await service.retry_processing(actor, candidate.job_id, candidate.id)

    async def test_a_live_attempt_cannot_be_retried(self):
        live = _candidate(processing_started_at=datetime.now(timezone.utc), pipeline_status_at=None)
        with self.assertRaises(CandidateBeingReviewedError):
            await self._retry(live)

    async def test_a_stalled_attempt_is_retried_with_a_fresh_count(self):
        stalled = _candidate(
            processing_started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
            processing_attempts=3, pipeline_status_at=None,
        )
        await self._retry(stalled)
        self.assertEqual(stalled.pipeline_status, "queued")
        self.assertEqual(stalled.processing_attempts, 0)
        self.assertIsNone(stalled.processing_token)


class StatusRouteTests(unittest.TestCase):
    def test_hr_sees_only_whether_review_is_available(self):
        from fastapi.testclient import TestClient

        from app.dependencies import get_current_user
        from app.main import app

        app.dependency_overrides[get_current_user] = lambda: User(
            id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="hr@example.com", full_name="HR",
            hashed_password="x", role="hr", is_active=True,
        )
        try:
            with mock.patch(
                "app.services.celery_health.celery_queue_available_async",
                mock.AsyncMock(return_value=False),
            ):
                response = TestClient(app).get("/api/resume-processing/status")
        finally:
            app.dependency_overrides.clear()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"available": False})


if __name__ == "__main__":
    unittest.main()
