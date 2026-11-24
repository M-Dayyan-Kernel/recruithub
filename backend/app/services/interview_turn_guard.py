"""Bound how long one candidate turn can last in the LiveKit interview agent.

The agent has no local VAD, so LiveKit runs in STT turn-detection mode: a turn ends only
when OpenAI's server VAD reports `speech_stopped`. Continuous background noise (a TV,
other voices) can keep that VAD in "speech" for minutes, and nothing in the pipeline
reaches the LLM until it stops. HRs saw ~4 minute waits for the next question.

Two built-ins were considered and do not work for this:
- LiveKit's `user_turn_limit` is evaluated only when a final transcript arrives, and
  OpenAI produces none until the buffer is committed — the stall itself.
- `AgentSession.commit_user_turn()` with live audio only *waits* for a final transcript;
  it never asks OpenAI to commit its buffer.

So the watchdog below tracks how long the user has been "speaking", and the stall handler
commits OpenAI's audio buffer itself to force a transcript out.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger("interview-agent")

_COMMIT_EVENT = {"type": "input_audio_buffer.commit"}


async def commit_openai_stt_buffer(stt: Any) -> int:
    """Ask OpenAI realtime transcription to close and transcribe its current audio segment.

    livekit-plugins-openai has no public API for this, so it reaches into the STT's open
    streams (`_streams`) and their websockets (`_ws`). The plugin sends this same event on
    the same socket, concurrently with its audio sender, in its own local-VAD path, so this
    is a supported message on that connection, just not a public method. If a plugin
    upgrade renames the attributes this logs and returns 0 instead of raising;
    `tests/test_interview_turn_guard.py` checks the real plugin so the drift is caught.

    Returns the number of streams the commit was sent to.
    """
    streams = getattr(stt, "_streams", None)
    if streams is None:
        logger.warning(
            "OpenAI STT has no _streams attribute — cannot force-commit the audio buffer "
            "(livekit-plugins-openai internals changed?)"
        )
        return 0

    committed = 0
    for stream in list(streams):
        ws = getattr(stream, "_ws", None)
        if ws is None or getattr(ws, "closed", True):
            continue
        try:
            await ws.send_json(_COMMIT_EVENT)
            committed += 1
        except Exception as exc:  # a dropped socket must not take the interview down
            logger.warning("Could not force-commit OpenAI STT buffer: %s", exc)
    return committed


StallHandler = Callable[[float], Awaitable[None]]


class UserTurnWatchdog:
    """Calls `on_stall(elapsed_seconds)` every `max_seconds` while the user stays "speaking".

    It keeps re-firing while the user state never leaves "speaking", because a forced
    commit doesn't end OpenAI's speech state: persistent noise gets broken up every cap.

    The handler runs as its own task. `user_stopped()` typically arrives *during* handling
    (once OpenAI finally reports speech_stopped), and cancelling the handler there would
    drop the reply it is about to generate.
    """

    def __init__(self, max_seconds: float, on_stall: StallHandler) -> None:
        if max_seconds <= 0:
            raise ValueError("max_seconds must be positive")
        self._max_seconds = max_seconds
        self._on_stall = on_stall
        self._timer: asyncio.Task[None] | None = None
        self._handlers: set[asyncio.Task[None]] = set()

    @property
    def armed(self) -> bool:
        return self._timer is not None and not self._timer.done()

    def user_started(self) -> None:
        if not self.armed:
            self._timer = asyncio.create_task(self._run(), name="user-turn-watchdog")

    def user_stopped(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def close(self) -> None:
        self.user_stopped()
        for task in list(self._handlers):
            task.cancel()
        self._handlers.clear()

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        started = loop.time()
        while True:
            await asyncio.sleep(self._max_seconds)
            task = asyncio.create_task(
                self._call_handler(loop.time() - started), name="user-turn-stall"
            )
            self._handlers.add(task)
            task.add_done_callback(self._handlers.discard)

    async def _call_handler(self, elapsed: float) -> None:
        try:
            await self._on_stall(elapsed)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Stalled-turn handler failed")
