"""
LiveKit AI Interview Agent — Sprint 6

Built from the official LiveKit starter pattern:
https://github.com/livekit-examples/agent-starter-python

Pattern:
  - AgentServer + @server.rtc_session decorator
  - Agent subclass with llm + instructions in __init__
  - session.start() BEFORE ctx.connect()
  - ctx.connect() at the end — framework manages lifecycle
  - session.say() to trigger first greeting

Usage:
    python interview_agent.py dev

Note: This worker process still reads LiveKit/OpenAI credentials from process
environment (.env). Per-tenant LiveKit projects require a dedicated agent per
tenant; backend room/token creation uses tenant credentials from SystemSettings.
"""

import asyncio
import logging
import os
import uuid

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    TurnHandlingOptions,
    cli,
    room_io,
)
from livekit.plugins import openai as lk_openai

from app.prompts.interview import (
    build_candidate_greeting,
    build_default_interview_prompt,
    build_interview_structure,
    build_interview_system_prompt,
    build_start_interview_instruction,
    format_rubric_block,
)
from app.core.config_loader import config

logger = logging.getLogger("interview-agent")
logging.basicConfig(level=logging.INFO)

# ---------------------------------------------------------------------------
# Noise cancellation — ai_coustics plugin (installed; requires AIC_API_KEY for
# production-quality enhancement; runs in offline/trial mode without one).
# ---------------------------------------------------------------------------
try:
    from livekit.plugins import ai_coustics
    _AIC_AVAILABLE = True
except ImportError:
    _AIC_AVAILABLE = False
    logger.warning("livekit-plugins-ai-coustics not installed — noise cancellation disabled")

AGENT_NAME = config.livekit.agent_name


def _validate_agent_env() -> None:
    """Fail fast with a clear message when required env vars are missing."""
    missing = [
        name
        for name in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "OPENAI_API_KEY")
        if not (os.environ.get(name) or "").strip()
    ]
    if missing:
        raise RuntimeError(
            "Interview agent cannot start — set in backend/.env: "
            + ", ".join(missing)
            + ". Then run: python interview_agent.py dev"
        )


def _validate_agent_env_on_startup() -> None:
    try:
        _validate_agent_env()
    except RuntimeError as exc:
        logger.error(str(exc))
        raise SystemExit(1) from exc


def _format_rubric_block(questions: list) -> str:
    return format_rubric_block(questions)


def _build_interview_structure(job) -> str:
    return build_interview_structure(
        job,
        max_follow_ups_per_topic=config.interview.max_follow_ups_per_topic,
    )


# ---------------------------------------------------------------------------
# Load session data from DB
# ---------------------------------------------------------------------------

async def _load_session_data(session_id: str) -> tuple[str, str, str]:
    """
    Returns (system_prompt, candidate_name, greeting).
    Falls back to defaults if DB load fails.
    """
    import sys
    sys.path.insert(0, os.path.dirname(__file__))

    from sqlalchemy import select
    from app.core.database import get_celery_db
    from app.models.models import InterviewSession, Candidate, Job

    try:
        async with get_celery_db() as db:
            session = (await db.execute(
                select(InterviewSession).where(InterviewSession.id == uuid.UUID(session_id))
            )).scalars().first()

            if not session:
                return _default_prompt(), "Candidate", "Hello! I am your AI interviewer. Shall we begin?"

            candidate = (await db.execute(
                select(Candidate).where(Candidate.id == session.candidate_id)
            )).scalars().first()

            job = (await db.execute(
                select(Job).where(Job.id == session.job_id)
            )).scalars().first()

        if not candidate or not job:
            return _default_prompt(), "Candidate", "Hello! I am your AI interviewer. Shall we begin?"

        parsed = candidate.parsed_data or {}
        skills = ", ".join(parsed.get("skills", [])) or "not listed"
        exp_years = parsed.get("total_experience_years", "unknown")
        current_role = parsed.get("current_role", "unknown")
        current_company = parsed.get("current_company", "unknown")
        required_skills = ", ".join(job.required_skills or []) or "not specified"
        interview_structure = _build_interview_structure(job)

        prompt = build_interview_system_prompt(
            candidate_name=candidate.name,
            current_role=current_role,
            current_company=current_company,
            experience_years=exp_years,
            skills=skills,
            job_title=job.title,
            required_skills=required_skills,
            job_description=job.description or "",
            interview_structure=interview_structure,
            max_follow_ups_per_topic=config.interview.max_follow_ups_per_topic,
        )

        greeting = build_candidate_greeting(candidate.name)

        return prompt, candidate.name, greeting

    except Exception as exc:
        logger.warning("Could not load session data (%s) — using defaults", exc)
        return _default_prompt(), "Candidate", "Hello! I am your AI interviewer from Webknot Technologies. Could you start by telling me a little about yourself?"


def _default_prompt() -> str:
    return build_default_interview_prompt(config.interview.max_follow_ups_per_topic)


# ---------------------------------------------------------------------------
# Save transcript to DB
# ---------------------------------------------------------------------------

async def _save_transcript(session_id: str, transcript: str) -> None:
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    from sqlalchemy import select
    from app.core.database import get_celery_db
    from app.models.models import InterviewSession

    try:
        async with get_celery_db() as db:
            session = (await db.execute(
                select(InterviewSession).where(InterviewSession.id == uuid.UUID(session_id))
            )).scalars().first()
            if session:
                session.transcript = transcript
                await db.commit()
                logger.info("Transcript saved: session=%s chars=%d", session_id, len(transcript))
    except Exception as exc:
        logger.error("Failed to save transcript: %s", exc)


async def _finalize_session(session_id: str, transcript_lines: list[str]) -> None:
    """Save transcript and schedule assessment (idempotent via Celery)."""
    if not session_id:
        return
    if transcript_lines:
        await _save_transcript(session_id, "\n".join(transcript_lines))
    try:
        import sys
        sys.path.insert(0, os.path.dirname(__file__))
        from app.tasks.interview_tasks import enqueue_interview_assessment

        enqueue_interview_assessment(session_id)
        logger.info("Assessment scheduled for session=%s", session_id)
    except Exception as exc:
        logger.error("Failed to schedule assessment for session=%s: %s", session_id, exc)


# ---------------------------------------------------------------------------
# AgentServer setup — correct pattern from official LiveKit docs
# ---------------------------------------------------------------------------

server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def interview_session(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    room_name = ctx.room.name
    session_id = room_name[len("interview-"):] if room_name.startswith("interview-") else None

    logger.info("Interview agent dispatched: room=%s session_id=%s", room_name, session_id)

    transcript_lines: list[str] = []

    def _on_conversation_item(event) -> None:
        try:
            msg = event.item
            role = getattr(msg, 'role', 'unknown')
            text = getattr(msg, 'text_content', None) or ''
            if not text:
                content = getattr(msg, 'content', None)
                if isinstance(content, list):
                    text = ' '.join(
                        p.get('text', '') if isinstance(p, dict) else str(p)
                        for p in content
                    )
            if text.strip():
                if text.strip().startswith('[Turn guidance]'):
                    return
                label = 'AI' if str(role) == 'assistant' else 'Candidate'
                transcript_lines.append(f'{label}: {text.strip()}')
                logger.debug('Transcript captured: [%s] %s', label, text.strip()[:80])
        except Exception as exc:
            logger.warning('Could not capture transcript item: %s', exc)

    try:
        # Load candidate/job data from DB
        system_prompt, candidate_name, greeting = (
            await _load_session_data(session_id) if session_id
            else (_default_prompt(), "Candidate", "Hello! I am your AI interviewer. Let us begin.")
        )

        logger.info("Starting interview for candidate=%s", candidate_name)

        openai_key = os.environ.get("OPENAI_API_KEY", "")
        if not openai_key.strip():
            raise RuntimeError("OPENAI_API_KEY is not set — interview agent cannot run STT/TTS/LLM")

        # Create agent — follow-up coaching is in system_prompt (on_user_turn_completed
        # injected assistant messages were blocking the reply pipeline after greeting).
        class InterviewAgent(Agent):
            def __init__(self):
                super().__init__(
                    instructions=system_prompt,
                    llm=lk_openai.LLM(
                        model=config.livekit.llm.name,
                        api_key=openai_key,
                    ),
                )

        # ---------------------------------------------------------------------------
        # Noise cancellation — build AudioInputOptions with ai_coustics enhancer.
        # ---------------------------------------------------------------------------
        noise_cancel = None
        audio_cfg = config.livekit.audio
        nc_cfg = audio_cfg.noise_cancellation
        if _AIC_AVAILABLE and nc_cfg.enabled:
            try:
                aic_api_key = os.environ.get("AIC_API_KEY")
                aic_auth = (
                    ai_coustics.Auth(api_key=aic_api_key)
                    if aic_api_key
                    else None
                )
                enhancer_model = getattr(
                    ai_coustics.EnhancerModel,
                    nc_cfg.model,
                    ai_coustics.EnhancerModel.ROOK_S,
                )
                noise_cancel = ai_coustics.AICousticsAudioEnhancer(
                    model=enhancer_model,
                    vad_settings=ai_coustics.VadSettings(
                        speech_hold_duration=None,
                        sensitivity=None,
                        minimum_speech_duration=None,
                    ),
                    auth=aic_auth,
                )
                logger.info(
                    "ai_coustics noise cancellation enabled (model=%s, auth=%s)",
                    nc_cfg.model,
                    "api_key" if aic_api_key else "offline/trial",
                )
            except Exception as exc:
                logger.warning(
                    "Could not initialise ai_coustics enhancer: %s — proceeding without noise cancellation",
                    exc,
                )
                noise_cancel = None

        audio_input_opts = room_io.AudioInputOptions(
            noise_cancellation=noise_cancel,
            auto_gain_control=audio_cfg.auto_gain_control,
            pre_connect_audio=audio_cfg.pre_connect_audio,
            pre_connect_audio_timeout=audio_cfg.pre_connect_timeout_seconds,
        )

        # Realtime STT with server VAD — whisper-1 batch mode often stalls after greeting.
        turn = config.livekit.turn_handling
        session = AgentSession(
            stt=lk_openai.STT(
                model=config.livekit.stt.name,
                use_realtime=config.livekit.stt.realtime,
                api_key=openai_key,
            ),
            tts=lk_openai.TTS(
                model=config.livekit.tts.name,
                voice=config.livekit.tts.voice,
                api_key=openai_key,
            ),
            turn_handling=TurnHandlingOptions(
                endpointing={"min_delay": turn.endpointing_min_delay},
                preemptive_generation={"preemptive_tts": turn.preemptive_tts},
                interruption={"enabled": turn.interruption_enabled},
            ),
        )

        await session.start(
            agent=InterviewAgent(),
            room=ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=audio_input_opts,
            ),
        )

        await ctx.connect()

        session.on('conversation_item_added', _on_conversation_item)

        def _on_user_transcribed(ev) -> None:
            text = getattr(ev, "transcript", "") or ""
            if text.strip():
                logger.info(
                    "Candidate speech transcribed (final=%s): %s",
                    getattr(ev, "is_final", False),
                    text.strip()[:120],
                )

        session.on('user_input_transcribed', _on_user_transcribed)

        await session.generate_reply(
            instructions=build_start_interview_instruction(greeting)
        )
        await session.wait_for_idle()

        logger.info("Greeting completed — listening for candidate=%s", candidate_name)

        room_closed = asyncio.Event()

        def _on_disconnected(*args):
            room_closed.set()

        ctx.room.on('disconnected', _on_disconnected)

        try:
            await room_closed.wait()
        except asyncio.CancelledError:
            pass
        finally:
            ctx.room.off('disconnected', _on_disconnected)
            session.off('conversation_item_added', _on_conversation_item)
            session.off('user_input_transcribed', _on_user_transcribed)

    except Exception as exc:
        logger.exception("Interview agent session error room=%s: %s", room_name, exc)
        raise
    finally:
        logger.info(
            'Room closed — transcript has %d lines for session=%s',
            len(transcript_lines),
            session_id,
        )
        await _finalize_session(session_id, transcript_lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    _validate_agent_env_on_startup()
    cli.run_app(server)
