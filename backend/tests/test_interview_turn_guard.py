"""Tests for the interview agent's stalled-turn guard."""

from __future__ import annotations

import asyncio
import inspect
import unittest

from app.services.interview_turn_guard import UserTurnWatchdog, commit_openai_stt_buffer


class _FakeWs:
    def __init__(self, *, closed: bool = False, fail: bool = False) -> None:
        self.closed = closed
        self.fail = fail
        self.sent: list[dict] = []

    async def send_json(self, data: dict) -> None:
        if self.fail:
            raise ConnectionError("socket dropped")
        self.sent.append(data)


class _FakeStream:
    def __init__(self, ws: _FakeWs | None) -> None:
        self._ws = ws


class _FakeStt:
    def __init__(self, *streams: _FakeStream) -> None:
        self._streams = set(streams)


class CommitOpenAiSttBufferTests(unittest.IsolatedAsyncioTestCase):
    async def test_commits_only_open_sockets(self) -> None:
        open_ws, closed_ws = _FakeWs(), _FakeWs(closed=True)
        stt = _FakeStt(_FakeStream(open_ws), _FakeStream(closed_ws), _FakeStream(None))

        self.assertEqual(await commit_openai_stt_buffer(stt), 1)
        self.assertEqual(open_ws.sent, [{"type": "input_audio_buffer.commit"}])
        self.assertEqual(closed_ws.sent, [])

    async def test_send_failure_is_not_raised(self) -> None:
        stt = _FakeStt(_FakeStream(_FakeWs(fail=True)))
        self.assertEqual(await commit_openai_stt_buffer(stt), 0)

    async def test_missing_internals_return_zero(self) -> None:
        self.assertEqual(await commit_openai_stt_buffer(object()), 0)

    def test_real_plugin_still_has_the_internals_we_use(self) -> None:
        # The helper relies on private attributes of livekit-plugins-openai. If an upgrade
        # renames them the forced commit silently stops working, so fail here instead.
        from livekit.plugins.openai import stt as openai_stt

        self.assertIn("self._streams", inspect.getsource(openai_stt.STT.__init__))
        self.assertIn("self._ws", inspect.getsource(openai_stt.SpeechStream.__init__))
        self.assertIn("input_audio_buffer.commit", inspect.getsource(openai_stt))


class UserTurnWatchdogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.calls: list[float] = []

        async def on_stall(elapsed: float) -> None:
            self.calls.append(elapsed)

        self.watchdog = UserTurnWatchdog(0.05, on_stall)

    async def asyncTearDown(self) -> None:
        self.watchdog.close()

    async def test_fires_after_cap_while_speaking(self) -> None:
        self.watchdog.user_started()
        await asyncio.sleep(0.08)
        self.assertEqual(len(self.calls), 1)
        self.assertGreaterEqual(self.calls[0], 0.05)

    async def test_does_not_fire_when_turn_ends_in_time(self) -> None:
        self.watchdog.user_started()
        await asyncio.sleep(0.02)
        self.watchdog.user_stopped()
        await asyncio.sleep(0.08)
        self.assertEqual(self.calls, [])

    async def test_refires_while_still_stuck(self) -> None:
        self.watchdog.user_started()
        await asyncio.sleep(0.13)
        self.assertEqual(len(self.calls), 2)

    async def test_repeated_start_does_not_reset_timer(self) -> None:
        # user_state_changed can repeat "speaking"; that must not postpone the cap.
        self.watchdog.user_started()
        await asyncio.sleep(0.03)
        self.watchdog.user_started()
        await asyncio.sleep(0.04)
        self.assertEqual(len(self.calls), 1)

    async def test_stop_during_handler_does_not_cancel_it(self) -> None:
        finished = asyncio.Event()

        async def slow_handler(elapsed: float) -> None:
            await asyncio.sleep(0.05)
            finished.set()

        watchdog = UserTurnWatchdog(0.02, slow_handler)
        watchdog.user_started()
        await asyncio.sleep(0.03)
        watchdog.user_stopped()  # OpenAI reports speech_stopped mid-handling
        await asyncio.wait_for(finished.wait(), timeout=1)
        watchdog.close()

    async def test_handler_error_is_contained(self) -> None:
        async def boom(elapsed: float) -> None:
            raise RuntimeError("handler failed")

        watchdog = UserTurnWatchdog(0.02, boom)
        watchdog.user_started()
        with self.assertLogs("interview-agent", level="ERROR"):
            await asyncio.sleep(0.05)
        self.assertTrue(watchdog.armed)
        watchdog.close()

    def test_rejects_non_positive_cap(self) -> None:
        with self.assertRaises(ValueError):
            UserTurnWatchdog(0, self._noop)

    @staticmethod
    async def _noop(elapsed: float) -> None:
        return None
