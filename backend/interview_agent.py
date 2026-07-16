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

from app.services.interview_question_constraints import (
    ORAL_ONLY_PROMPT_RULES,
    TECHNICAL_ONLY_PROMPT_RULES,
    derive_difficulty_hint,
)

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

AGENT_NAME = "interview-agent"
MAX_FOLLOW_UPS_PER_TOPIC = 2
THIN_ANSWER_WORD_LIMIT = 25


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


def _is_thin_answer(text: str) -> bool:
    """Heuristic: short, vague, or lacking concrete detail."""
    cleaned = (text or "").strip()
    if not cleaned:
        return True

    words = cleaned.split()
    if len(words) < THIN_ANSWER_WORD_LIMIT:
        return True

    lower = cleaned.lower()
    vague_markers = (
        "i think", "kind of", "basically", "not sure", "maybe",
        "i guess", "something like", "sort of", "i don't remember",
    )
    if any(marker in lower for marker in vague_markers) and len(words) < 60:
        return True

    concrete_markers = (
        "for example", "we built", "i led", "i designed", "result",
        "because", "trade-off", "tradeoff", "latency", "users",
        "team", "shipped", "implemented", "reduced", "improved",
    )
    if not any(marker in lower for marker in concrete_markers) and len(words) < 50:
        return True

    return False


def _adaptive_followup_rules() -> str:
    return f"""ADAPTIVE FOLLOW-UP RULES (critical):
- After every substantive answer, pause and assess depth before changing topic.
- A thin answer is: very short, generic, buzzword-heavy, or missing examples and specifics.
- When thin: ask 1 short follow-up grounded in THEIR words — e.g. "Can you walk me through a specific example?", "What was your role in that?", "What trade-offs did you consider?"
- When adequate (concrete example, clear reasoning, specific details): acknowledge briefly and advance.
- Never ask more than {MAX_FOLLOW_UPS_PER_TOPIC} follow-ups on the same topic — then move on even if still shallow.
- Follow-ups must reference what they just said; do not introduce unrelated new topics.
- Do not reveal rubric scores, expected answers, or hiring decisions.
- This is voice-only: never ask the candidate to write code, type syntax, open an IDE, share their screen, or do a live coding exercise. Probe understanding through explanation and examples from their experience."""


def _format_rubric_block(questions: list) -> str:
    lines = []
    for i, q in enumerate(questions, start=1):
        if isinstance(q, dict):
            text = (q.get("question") or "").strip()
            score = q.get("score", "")
        else:
            text = ""
            score = ""
        if text:
            lines.append(f"{i}. {text} (worth {score} points)")
    return "\n".join(lines)


def _build_interview_structure(job) -> str:
    questions = job.interview_questions or []
    valid = [q for q in questions if isinstance(q, dict) and (q.get("question") or "").strip()]
    if valid:
        rubric = _format_rubric_block(valid)
        return f"""INTERVIEW STRUCTURE (follow this order):
1. You have already greeted the candidate — move straight to asking for a brief self-introduction
2. Ask EACH rubric question below IN ORDER — use the exact intent of each question, phrased for spoken answers only (explain / describe / walk through — never ask them to write or run code).
3. After each rubric answer, apply ADAPTIVE FOLLOW-UP RULES before the next rubric question.
4. Do not skip any rubric question. Do not reveal point values to the candidate.
5. Ask about their interest in this role at Webknot
6. Let them ask one or two questions
7. Close warmly — thank them, say the hiring team will follow up

{ORAL_ONLY_PROMPT_RULES}

{TECHNICAL_ONLY_PROMPT_RULES}

RUBRIC QUESTIONS (mandatory — ask in order):
{rubric}"""
    difficulty = derive_difficulty_hint(job)
    return f"""INTERVIEW STRUCTURE (follow this order):
1. You have already greeted the candidate — move straight to asking for a brief self-introduction
2. Ask 3-4 technical questions relevant to {job.title} and required skills — oral answers only (no live coding)
3. After each answer, apply ADAPTIVE FOLLOW-UP RULES before moving on — technical probes only, no behavioural follow-ups
4. Ask about their interest in this role at Webknot
5. Let them ask one or two questions
6. Close warmly — thank them, say the hiring team will follow up

{difficulty}

{ORAL_ONLY_PROMPT_RULES}

{TECHNICAL_ONLY_PROMPT_RULES}"""


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

        prompt = f"""You are a professional AI interviewer conducting a structured technical interview on behalf of Webknot Technologies. Speak naturally — this is a voice conversation.

CANDIDATE: {candidate.name}
CURRENT ROLE: {current_role} at {current_company}  
EXPERIENCE: {exp_years} years
SKILLS: {skills}
ROLE: {job.title}
REQUIRED SKILLS: {required_skills}
JOB: {(job.description or '')[:400]}

{interview_structure}

{_adaptive_followup_rules()}

VOICE RULES:
- Speak in short, natural sentences — this is voice, not text
- No bullet points, no markdown, no lists
- Listen fully, then respond — probe thin answers before advancing
- Be warm, encouraging, and professional
- Keep total interview to 10-15 minutes
- Do NOT reveal scores or make hiring decisions on the call
- Do NOT ask for live coding, written code, screen sharing, or running programs — only spoken answers
- Do NOT ask behavioural or soft-skill questions — technical probes only

{ORAL_ONLY_PROMPT_RULES}

{TECHNICAL_ONLY_PROMPT_RULES}"""

        greeting = f"Hello {candidate.name}! I'm your AI interviewer from Webknot Technologies today. Thank you for joining us. I'd love to start by having you tell me a little about yourself and your background."

        return prompt, candidate.name, greeting

    except Exception as exc:
        logger.warning("Could not load session data (%s) — using defaults", exc)
        return _default_prompt(), "Candidate", "Hello! I am your AI interviewer from Webknot Technologies. Could you start by telling me a little about yourself?"


def _default_prompt() -> str:
    return f"""You are a professional AI interviewer at Webknot Technologies conducting a voice-only technical interview.
Cover: brief background, technical skills, and role-relevant technical questions. Be warm and encouraging.

{_adaptive_followup_rules()}

{ORAL_ONLY_PROMPT_RULES}

{TECHNICAL_ONLY_PROMPT_RULES}

Speak in short natural sentences — no markdown or bullet points."""


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
                    llm=lk_openai.LLM(model="gpt-4o-mini", api_key=openai_key),
                )

        # ---------------------------------------------------------------------------
        # Noise cancellation — build AudioInputOptions with ai_coustics enhancer.
        # ---------------------------------------------------------------------------
        noise_cancel = None
        if _AIC_AVAILABLE:
            try:
                aic_api_key = os.environ.get("AIC_API_KEY")
                aic_auth = (
                    ai_coustics.Auth(api_key=aic_api_key)
                    if aic_api_key
                    else None
                )
                noise_cancel = ai_coustics.AICousticsAudioEnhancer(
                    model=ai_coustics.EnhancerModel.ROOK_S,
                    vad_settings=ai_coustics.VadSettings(
                        speech_hold_duration=None,
                        sensitivity=None,
                        minimum_speech_duration=None,
                    ),
                    auth=aic_auth,
                )
                logger.info("ai_coustics noise cancellation enabled (model=ROOK_S, auth=%s)",
                            "api_key" if aic_api_key else "offline/trial")
            except Exception as exc:
                logger.warning("Could not initialise ai_coustics enhancer: %s — proceeding without noise cancellation", exc)
                noise_cancel = None

        audio_input_opts = room_io.AudioInputOptions(
            noise_cancellation=noise_cancel,
            auto_gain_control=True,
            pre_connect_audio=True,
            pre_connect_audio_timeout=30.0,
        )

        # Realtime STT with server VAD — whisper-1 batch mode often stalls after greeting.
        session = AgentSession(
            stt=lk_openai.STT(
                model="gpt-4o-mini-transcribe",
                use_realtime=True,
                api_key=openai_key,
            ),
            tts=lk_openai.TTS(model="tts-1", voice="nova", api_key=openai_key),
            turn_handling=TurnHandlingOptions(
                endpointing={"min_delay": 0.5},
                preemptive_generation={"preemptive_tts": True},
                interruption={"enabled": True},
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
            instructions=f"Start the interview now. Begin with this exact greeting: '{greeting}'"
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
