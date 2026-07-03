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
    inference,
    room_io,
)
from livekit.plugins import openai as lk_openai

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
2. Ask EACH rubric question below IN ORDER — use the exact intent of each question. Probe with follow-ups until you have enough depth, then move on.
3. Do not skip any rubric question. Do not reveal point values to the candidate.
4. Ask about their interest in this role at Webknot
5. Let them ask one or two questions
6. Close warmly — thank them, say the hiring team will follow up

RUBRIC QUESTIONS (mandatory — ask in order):
{rubric}"""
    return f"""INTERVIEW STRUCTURE (follow this order):
1. You have already greeted the candidate — move straight to asking for a brief self-introduction
2. Ask 2-3 technical questions relevant to {job.title} and their skills — ask follow-ups based on answers
3. One behavioural question (challenging project, conflict resolution, or leadership)
4. Ask about their interest in this role at Webknot
5. Let them ask one or two questions
6. Close warmly — thank them, say the hiring team will follow up"""


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

VOICE RULES:
- Speak in short, natural sentences — this is voice, not text
- No bullet points, no markdown, no lists
- Listen and ask follow-ups based on what they say
- Be warm, encouraging, and professional
- Keep total interview to 10-15 minutes
- Do NOT reveal scores or make hiring decisions on the call"""

        greeting = f"Hello {candidate.name}! I'm your AI interviewer from Webknot Technologies today. Thank you for joining us. I'd love to start by having you tell me a little about yourself and your background."

        return prompt, candidate.name, greeting

    except Exception as exc:
        logger.warning("Could not load session data (%s) — using defaults", exc)
        return _default_prompt(), "Candidate", "Hello! I am your AI interviewer from Webknot Technologies. Could you start by telling me a little about yourself?"


def _default_prompt() -> str:
    return """You are a professional AI interviewer at Webknot Technologies conducting a voice interview.
Cover: background, technical skills, a behavioural question, and role interest. Be warm and encouraging.
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

    # Load candidate/job data from DB
    system_prompt, candidate_name, greeting = (
        await _load_session_data(session_id) if session_id
        else (_default_prompt(), "Candidate", "Hello! I am your AI interviewer. Let us begin.")
    )

    logger.info("Starting interview for candidate=%s", candidate_name)

    openai_key = os.environ.get("OPENAI_API_KEY", "")

    # Create agent with instructions
    class InterviewAgent(Agent):
        def __init__(self):
            super().__init__(
                instructions=system_prompt,
                llm=lk_openai.LLM(model="gpt-4o", api_key=openai_key),
            )

    # ---------------------------------------------------------------------------
    # Noise cancellation — build AudioInputOptions with ai_coustics enhancer.
    # The enhancer runs locally using the ROOK_S model (smallest, lowest latency).
    # Auth is optional; without AIC_API_KEY it operates in offline/trial mode.
    # If the plugin is unavailable, auto_gain_control still provides basic cleanup.
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
                model=ai_coustics.EnhancerModel.ROOK_S,  # smallest/fastest
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
        noise_cancellation=noise_cancel,  # None = AGC only if ai_coustics unavailable
        auto_gain_control=True,
    )

    # ---------------------------------------------------------------------------
    # Build session with STT + TTS pipeline + turn detection tuned for
    # Indian English (TurnDetector uses a local ML model — no extra latency).
    # preemptive_generation=True starts drafting the reply while the candidate
    # is still finishing their sentence, reducing perceived response time.
    # ---------------------------------------------------------------------------
    session = AgentSession(
        stt=lk_openai.STT(model="whisper-1", api_key=openai_key),
        tts=lk_openai.TTS(model="tts-1", voice="nova", api_key=openai_key),
        turn_handling=TurnHandlingOptions(
            turn_detection=inference.TurnDetector(),
        ),
        preemptive_generation=True,
    )

    # Start the session (BEFORE ctx.connect() — per official pattern)
    await session.start(
        agent=InterviewAgent(),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=audio_input_opts,
        ),
    )

    # Connect to the room — framework manages lifecycle after this
    await ctx.connect()

    # Capture transcript in real-time via conversation_item_added event
    transcript_lines: list[str] = []

    def _on_conversation_item(event) -> None:
        try:
            msg = event.item
            role = getattr(msg, 'role', 'unknown')
            text = getattr(msg, 'text_content', None) or ''
            if not text:
                # fallback: check content list
                content = getattr(msg, 'content', None)
                if isinstance(content, list):
                    text = ' '.join(
                        p.get('text', '') if isinstance(p, dict) else str(p)
                        for p in content
                    )
            if text.strip():
                label = 'AI' if str(role) == 'assistant' else 'Candidate'
                transcript_lines.append(f'{label}: {text.strip()}')
                logger.debug('Transcript captured: [%s] %s', label, text.strip()[:80])
        except Exception as exc:
            logger.warning('Could not capture transcript item: %s', exc)

    session.on('conversation_item_added', _on_conversation_item)

    # Greet the candidate using generate_reply() — flows through normal conversation
    # pipeline so interruptions resume properly, unlike session.say() which is raw injection.
    await session.generate_reply(
        instructions=f"Start the interview now. Begin with this exact greeting: '{greeting}'"
    )

    logger.info("Greeting initiated for candidate=%s", candidate_name)

    # Keep agent alive until the room closes naturally
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

    logger.info('Room closed — transcript has %d lines for session=%s', len(transcript_lines), session_id)

    if session_id and transcript_lines:
        await _save_transcript(session_id, '\n'.join(transcript_lines))
        # Trigger assessment AFTER transcript is saved (fixes race condition)
        try:
            import sys
            sys.path.insert(0, os.path.dirname(__file__))
            from app.tasks.interview_tasks import generate_interview_report
            generate_interview_report.delay(session_id)
            logger.info('Assessment task enqueued for session=%s', session_id)
        except Exception as exc:
            logger.error('Failed to enqueue assessment task: %s', exc)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    cli.run_app(server)
