"""
Mock external API integrations for local development without burning API credits.

Enable with MOCK_EXTERNAL_APIS=true in backend/.env (or granular flags below).
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from app.core.config_loader import config

logger = logging.getLogger(__name__)

MOCK_VAPI_TRANSCRIPT = """AI: Hello, this is an AI assistant calling regarding your application. Do you have a few minutes?
User: Yes, sure.
AI: Great. When would you be available to start if selected?
User: I can join in 30 days after serving my notice period.
AI: What is your current CTC and expected CTC?
User: My current CTC is 12 LPA and I'm expecting around 16 to 18 LPA.
AI: What is your notice period?
User: 30 days, negotiable to 15 days.
AI: Thank you for your time. We'll review your responses and be in touch soon. Goodbye!
User: Thank you, goodbye."""


def mock_openai_enabled() -> bool:
    return config.MOCK_EXTERNAL_APIS or config.MOCK_OPENAI


def mock_vapi_enabled() -> bool:
    return config.MOCK_EXTERNAL_APIS or config.MOCK_VAPI


def mock_livekit_enabled() -> bool:
    return config.MOCK_EXTERNAL_APIS or config.MOCK_LIVEKIT


def mock_email_enabled() -> bool:
    return config.MOCK_EXTERNAL_APIS or config.MOCK_EMAIL


def active_mock_services() -> list[str]:
    services: list[str] = []
    if mock_openai_enabled():
        services.append("openai")
    if mock_vapi_enabled():
        services.append("vapi")
    if mock_livekit_enabled():
        services.append("livekit")
    if mock_email_enabled():
        services.append("email")
    return services


def log_mock_usage(service: str, action: str) -> None:
    logger.info("[MOCK %s] %s — no external API call made", service.upper(), action)


def mock_resume_parse(raw_text: str) -> dict:
    log_mock_usage("openai", "resume parse (gpt-4o)")
    return {
        "name": "Rahul mock",
        "email": "rahulag5282@gmail.com",
        "phone": "+918217691992",
        "skills": ["Python", "FastAPI", "React", "PostgreSQL", "Docker"],
        "total_experience_years": 4.5,
        "experience": [
            {
                "company": "Mock Tech Pvt Ltd",
                "title": "Software Engineer",
                "duration": "2021 – Present",
                "description": "Built APIs and web applications (mock parsed data).",
            }
        ],
        "education": [
            {
                "institution": "Mock University",
                "degree": "B.Tech",
                "field": "Computer Science",
                "year": "2020",
            }
        ],
        "current_company": "Mock Tech Pvt Ltd",
        "current_role": "Software Engineer",
    }


def mock_jd_parse(raw_text: str) -> dict:
    log_mock_usage("openai", "JD parse (gpt-4o)")
    title = "Mock Parsed Role"
    for line in (raw_text or "").splitlines():
        stripped = line.strip()
        if stripped and len(stripped) < 80:
            title = stripped[:80]
            break
    qid = str(uuid.uuid4())
    iid = str(uuid.uuid4())
    return {
        "title": title,
        "description": (raw_text or "Mock job description from uploaded file.")[:2000],
        "required_skills": ["Python", "SQL", "REST APIs", "Git"],
        "experience_min": 2,
        "experience_max": 6,
        "screening_questions": [
            {
                "id": str(uuid.uuid4()),
                "question": "Do you have hands-on experience with the core stack mentioned in this role?",
            }
        ],
        "interview_questions": [
            {
                "id": iid,
                "question": "Walk me through how you would design a REST API for a recruitment workflow.",
                "score": 50,
            },
            {
                "id": qid,
                "question": "Describe a production bug you diagnosed and how you fixed it.",
                "score": 50,
            },
        ],
    }


def mock_combined_shortlist() -> CombinedShortlistOutput:
    from app.schemas.ai_outputs import CombinedShortlistOutput, ParsedResumeData, ShortlistAssessment

    log_mock_usage("openai", "combined resume shortlist (gpt-4o)")
    profile = ParsedResumeData.model_validate(mock_resume_parse(""))
    assessment = ShortlistAssessment(
        match_score=72.0,
        recommendation="shortlisted",
        strengths=["Relevant stack experience", "Reasonable tenure in similar roles"],
        gaps=["Limited domain exposure (mock assessment)"],
        reason="Mock shortlist: candidate appears to meet core requirements for further screening.",
    )
    return CombinedShortlistOutput(profile=profile, assessment=assessment)


def mock_shortlist_assessment() -> tuple[float, str, list[str], list[str], str]:
    log_mock_usage("openai", "shortlist assessment (gpt-4o)")
    return (
        72.0,
        "shortlisted",
        ["Relevant stack experience", "Reasonable tenure in similar roles"],
        ["Limited domain exposure (mock assessment)"],
        "Mock shortlist: candidate appears to meet core requirements for further screening.",
    )


def mock_expected_points(question_text: str) -> list[str]:
    log_mock_usage("openai", "expected answer points (gpt-4o)")
    topic = (question_text or "this topic")[:60]
    return [
        f"Demonstrates practical experience with {topic}",
        "Explains trade-offs and constraints clearly",
        "Uses a concrete example from past work",
    ]


def mock_screening_extraction() -> dict:
    log_mock_usage("openai", "screening field extraction (gpt-4o)")
    return {
        "availability": "30 days",
        "employment_status": "Currently employed",
        "relevant_experience": "4+ years in software development (mock extraction).",
        "current_ctc": "12 LPA",
        "expected_ctc": "16-18 LPA",
        "notice_period": "30 days",
        "location_preference": "Open to hybrid",
        "communication_quality": "good",
        "willingness_to_proceed": True,
        "summary": "Mock screening: candidate answered availability, CTC, and notice period questions positively.",
        "result": "pass",
    }


def mock_interview_assessment(transcript: str, job, candidate) -> dict:
    log_mock_usage("openai", "interview assessment (gpt-4o)")
    rubric = getattr(job, "interview_questions", None) or []
    if rubric:
        question_scores = []
        total = 0
        for q in rubric:
            if not isinstance(q, dict):
                continue
            max_score = int(q.get("score") or 0)
            if max_score < 1:
                continue
            earned = max(1, int(max_score * 0.75))
            total += earned
            expected = q.get("expected_points") or []
            entry = {
                "id": str(q.get("id") or ""),
                "question": q.get("question", ""),
                "score": max_score,
                "earned_score": earned,
                "notes": "Mock rubric assessment — 75% coverage.",
                "candidate_answer": "Candidate discussed relevant experience (mock).",
                "expected_points": expected or None,
                "candidate_points": ["Used a concrete example", "Explained trade-offs"],
            }
            if expected:
                entry["point_coverage"] = [
                    {"point": p, "covered": True} for p in expected[: max(1, len(expected) - 1)]
                ] + (
                    [{"point": expected[-1], "covered": False}] if expected else []
                )
                entry["earned_score"] = None
            question_scores.append(entry)
        return {
            "assessment_mode": "rubric",
            "question_scores": question_scores,
            "overall_score": total,
            "rubric_total": sum(int(q.get("score") or 0) for q in rubric if isinstance(q, dict)),
            "strengths": ["Clear communication", "Relevant technical examples"],
            "weaknesses": ["Some depth gaps on advanced topics (mock)"],
            "jd_fit": "Mock assessment: candidate aligns reasonably well with the role requirements.",
            "final_recommendation": "hire",
            "summary": "Mock interview report generated without calling OpenAI.",
            "transcript_summary": (transcript or MOCK_VAPI_TRANSCRIPT)[:300],
        }

    return {
        "assessment_mode": "legacy",
        "technical_fit_score": 78,
        "communication_score": 82,
        "problem_solving_score": 75,
        "experience_score": 80,
        "role_alignment_score": 77,
        "overall_score": 78,
        "strengths": ["Strong fundamentals", "Good communication"],
        "weaknesses": ["Limited system design depth (mock)"],
        "jd_fit": "Mock assessment: candidate is a reasonable fit for the role.",
        "final_recommendation": "hire",
        "summary": "Mock interview report generated without calling OpenAI.",
        "transcript_summary": (transcript or MOCK_VAPI_TRANSCRIPT)[:300],
    }


def mock_vapi_call_id() -> str:
    return f"mock-vapi-{uuid.uuid4()}"


def mock_vapi_get_call(vapi_call_id: str) -> dict:
    log_mock_usage("vapi", f"GET /call/{vapi_call_id}")
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": vapi_call_id,
        "status": "ended",
        "endedReason": "assistant-ended-call",
        "endedAt": now,
        "startedAt": now,
        "artifact": {
            "transcript": MOCK_VAPI_TRANSCRIPT,
            "transcriptText": MOCK_VAPI_TRANSCRIPT,
        },
    }


def mock_livekit_token(room_name: str, identity: str) -> str:
    log_mock_usage("livekit", f"JWT for {identity} in {room_name}")
    payload = {
        "mock": True,
        "room": room_name,
        "identity": identity,
        "note": "LiveKit room not created — set MOCK_LIVEKIT=false for real interviews",
    }
    return "mock." + json.dumps(payload, separators=(",", ":"))


def mock_email_send(to_email: str, subject: str) -> bool:
    log_mock_usage("email", f'to={to_email} subject="{subject}"')
    return True
