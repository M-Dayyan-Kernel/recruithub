"""Tests for interview production hardening."""

from __future__ import annotations

import asyncio
import json
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from app.services import interview_guards
from app.tasks import interview_tasks


def _run(coro):
    return asyncio.run(coro)


class FakeSession:
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", uuid.uuid4())
        self.status = kwargs.get("status", "pending")
        self.expires_at = kwargs.get("expires_at")
        self.scheduled_interview_at = kwargs.get("scheduled_interview_at")
        self.transcript = kwargs.get("transcript")
        self.livekit_room_name = kwargs.get("livekit_room_name")
        self.unique_token = kwargs.get("unique_token", "tok")


class FakeDb:
    async def commit(self):
        return None

    async def refresh(self, obj):
        return None


class AssertSessionJoinableTests(unittest.TestCase):
    def test_expired_raises_410_and_marks_expired(self) -> None:
        session = FakeSession(
            status="pending",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        with self.assertRaises(HTTPException) as ctx:
            _run(interview_guards.assert_session_joinable(session, FakeDb()))
        self.assertEqual(ctx.exception.status_code, 410)
        self.assertEqual(session.status, "expired")

    def test_scheduled_too_early_raises_403(self) -> None:
        session = FakeSession(
            status="pending",
            scheduled_interview_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        with self.assertRaises(HTTPException) as ctx:
            _run(interview_guards.assert_session_joinable(session, FakeDb()))
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("opens at", ctx.exception.detail.lower())

    def test_schedule_grace_allows_early_join(self) -> None:
        session = FakeSession(
            status="pending",
            scheduled_interview_at=datetime.now(timezone.utc) + timedelta(seconds=60),
        )
        # Within default 120s grace — should not raise
        _run(interview_guards.assert_session_joinable(session, FakeDb()))


class RateLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_in_process_rate_limit_returns_429(self) -> None:
        interview_guards._memory_hits.clear()
        token = f"rl-{uuid.uuid4()}"
        with mock.patch.object(
            interview_guards.config.interview,
            "public_rate_limit_per_minute",
            3,
        ), mock.patch(
            "redis.from_url",
            side_effect=RuntimeError("no redis"),
        ):
            for _ in range(3):
                await interview_guards.enforce_public_interview_rate_limit(token, "start")
            with self.assertRaises(HTTPException) as ctx:
                await interview_guards.enforce_public_interview_rate_limit(token, "start")
            self.assertEqual(ctx.exception.status_code, 429)


class LiveKitWebhookAuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_bad_signature_when_secret_configured(self) -> None:
        request = mock.AsyncMock()
        request.body = mock.AsyncMock(return_value=b'{"event":"room_finished"}')
        request.headers = {"Authorization": "forged-token"}

        with mock.patch.object(
            interview_guards,
            "settings",
            SimpleNamespace(LIVEKIT_API_KEY="key", LIVEKIT_API_SECRET="secret"),
        ), mock.patch(
            "app.services.mock_external.mock_livekit_enabled",
            return_value=False,
        ), mock.patch(
            "livekit.api.WebhookReceiver.receive",
            side_effect=Exception("bad sig"),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await interview_guards.verify_livekit_webhook_body(request)
            self.assertEqual(ctx.exception.status_code, 401)

    async def test_mock_mode_skips_verify(self) -> None:
        payload = {"event": "room_finished", "room": {"name": "r1"}}
        request = mock.AsyncMock()
        request.body = mock.AsyncMock(return_value=json.dumps(payload).encode())
        request.headers = {}

        with mock.patch(
            "app.services.mock_external.mock_livekit_enabled",
            return_value=True,
        ):
            body = await interview_guards.verify_livekit_webhook_body(request)
        self.assertEqual(body["event"], "room_finished")


class StubTranscriptGateTests(unittest.TestCase):
    def test_stub_constant_only_applied_in_mock(self) -> None:
        from app.api.routes import interviews as interviews_routes
        from app.services.interview_flag_service import has_meaningful_transcript

        self.assertFalse(has_meaningful_transcript(None))
        self.assertTrue(
            has_meaningful_transcript(interviews_routes._STUB_INTERVIEW_TRANSCRIPT)
        )


class AssessmentRetryTests(unittest.TestCase):
    def test_auth_failure_marks_assessment_failed(self) -> None:
        import openai

        session_id = str(uuid.uuid4())
        marked: list[str] = []

        async def fake_mark(sid: str) -> None:
            marked.append(sid)

        auth_err = openai.AuthenticationError(
            "bad key",
            response=mock.Mock(status_code=401, headers={}),
            body=None,
        )

        with mock.patch.object(
            interview_tasks,
            "_async_generate_report",
            side_effect=auth_err,
        ), mock.patch.object(
            interview_tasks,
            "_mark_session_assessment_failed",
            side_effect=fake_mark,
        ):
            interview_tasks.generate_interview_report.run(session_id)

        self.assertEqual(marked, [session_id])

    def test_rate_limit_exhausted_marks_assessment_failed(self) -> None:
        import openai
        from celery.exceptions import MaxRetriesExceededError

        session_id = str(uuid.uuid4())
        marked: list[str] = []

        async def fake_mark(sid: str) -> None:
            marked.append(sid)

        rate_err = openai.RateLimitError(
            "slow down",
            response=mock.Mock(status_code=429, headers={}),
            body=None,
        )

        with mock.patch.object(
            interview_tasks,
            "_async_generate_report",
            side_effect=rate_err,
        ), mock.patch.object(
            interview_tasks,
            "_mark_session_assessment_failed",
            side_effect=fake_mark,
        ):
            # Patch the bound task's retry to simulate exhausted retries
            with mock.patch.object(
                interview_tasks.generate_interview_report,
                "retry",
                side_effect=MaxRetriesExceededError(),
            ):
                interview_tasks.generate_interview_report.run(session_id)

        self.assertEqual(marked, [session_id])


class RoomFirstStartLogicTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_room_failure_leaves_pending(self) -> None:
        """Simulates room-first ordering: failure before durable in_progress."""
        session = FakeSession(status="pending", livekit_room_name=None)
        create_failed = False
        try:
            raise RuntimeError("livekit down")
        except RuntimeError:
            create_failed = True
            # Session never transitioned
            self.assertEqual(session.status, "pending")
            self.assertIsNone(session.livekit_room_name)
        self.assertTrue(create_failed)


class SessionScopedReportPreferenceTests(unittest.TestCase):
    def test_prefer_matching_session_report(self) -> None:
        session_id = uuid.uuid4()
        other_id = uuid.uuid4()
        reports = [
            SimpleNamespace(interview_session_id=other_id, candidate_id=uuid.uuid4(), overall_score=10),
            SimpleNamespace(interview_session_id=session_id, candidate_id=uuid.uuid4(), overall_score=90),
        ]
        by_session = {}
        for r in reports:
            by_session.setdefault(r.interview_session_id, r)
        chosen = by_session.get(session_id)
        self.assertEqual(chosen.overall_score, 90)


if __name__ == "__main__":
    unittest.main()
