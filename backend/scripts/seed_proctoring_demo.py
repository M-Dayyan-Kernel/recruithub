"""Seed demo interview sessions for testing the proctored candidate app.

Creates (idempotently) one tenant, one HR login, one job with an interview
rubric, and three candidates whose interview links can be opened directly in
the candidate app:

    python -m scripts.seed_proctoring_demo                 # from backend/, venv active
    python -m scripts.seed_proctoring_demo --label round2  # a separate job + links

Tokens are fixed so the URLs stay stable across runs:

    proctor-<label>-1   pending    - start a fresh proctored interview
    proctor-<label>-2   pending    - spare link
    proctor-<label>-3   completed  - "already completed" landing state

Re-running re-arms the pending links (status, timings and room details are reset)
so the same URL can be walked through again. It never touches other tenants.
Uses only existing tables - no schema or API changes.
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config_loader import config
from app.core.security import hash_password
from app.models.models import (
    Candidate,
    InterviewReport,
    InterviewSession,
    Job,
    ScreeningCall,
    SystemSettings,
    Tenant,
    User,
)

TENANT_SLUG = "proctor-demo"
TENANT_NAME = "Proctor Demo Org"
# example.com is IANA-reserved for docs and passes EmailStr validation;
# .local / .test / .invalid are special-use names that pydantic rejects.
HR_EMAIL = "hr@proctor-demo.example.com"
LEGACY_HR_EMAILS = ("hr@proctor-demo.local",)
HR_PASSWORD = "Demo@12345"
JOB_TITLE_BASE = "Backend Engineer (Proctoring Demo"

INTERVIEW_QUESTIONS = [
    {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "proctor-demo-q1")),
        "question": "How would you design retries for a Celery worker that calls a flaky API?",
        "score": 30,
        "expected_points": ["exponential backoff", "idempotency", "dead-letter handling"],
    },
    {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "proctor-demo-q2")),
        "question": "Walk me through how you would model a multi-tenant PostgreSQL schema.",
        "score": 35,
        "expected_points": ["tenant_id scoping", "indexes", "cascade deletes"],
    },
    {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "proctor-demo-q3")),
        "question": "Describe how you would debug a FastAPI endpoint that intermittently times out.",
        "score": 35,
        "expected_points": ["tracing/logs", "DB query analysis", "async blocking calls"],
    },
]

# (candidate name, email, session status)
DEMO_CANDIDATES = [
    ("Asha Rao", "asha.rao@example.com", "pending"),
    ("Vikram Iyer", "vikram.iyer@example.com", "pending"),
    ("Neha Gupta", "neha.gupta@example.com", "completed"),
]


def job_title_for(label: str) -> str:
    """Each label gets its own job, so seeded rounds stay independent."""
    return f"{JOB_TITLE_BASE} {label})" if label != "demo" else f"{JOB_TITLE_BASE})"


def token_for(label: str, index: int) -> str:
    return f"proctor-{label}-{index}"


async def _get_or_create_tenant(db: AsyncSession) -> Tenant:
    tenant = (
        await db.execute(select(Tenant).where(Tenant.slug == TENANT_SLUG))
    ).scalars().first()
    if tenant:
        return tenant

    tenant = Tenant(
        name=TENANT_NAME,
        slug=TENANT_SLUG,
        is_active=True,
        verification_status="approved",
    )
    db.add(tenant)
    await db.flush()
    db.add(SystemSettings(tenant_id=tenant.id, allowed_phone_regions=["IN"]))
    await db.flush()
    return tenant


async def _get_or_create_hr_user(db: AsyncSession, tenant: Tenant) -> User:
    user = (
        await db.execute(select(User).where(User.email == HR_EMAIL))
    ).scalars().first()

    if not user:
        # Earlier runs seeded an unusable .local address - move it over.
        legacy = (
            await db.execute(select(User).where(User.email.in_(LEGACY_HR_EMAILS)))
        ).scalars().first()
        if legacy:
            legacy.email = HR_EMAIL
            user = legacy
    if user:
        # Keep the demo password predictable across runs.
        user.hashed_password = hash_password(HR_PASSWORD)
        user.tenant_id = tenant.id
        user.is_active = True
        return user

    user = User(
        tenant_id=tenant.id,
        email=HR_EMAIL,
        full_name="Proctor Demo HR",
        hashed_password=hash_password(HR_PASSWORD),
        role="admin",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _get_or_create_job(db: AsyncSession, tenant: Tenant, title: str) -> Job:
    job = (
        await db.execute(
            select(Job).where(Job.tenant_id == tenant.id, Job.title == title)
        )
    ).scalars().first()
    if job:
        job.interview_questions = INTERVIEW_QUESTIONS
        return job

    job = Job(
        tenant_id=tenant.id,
        title=title,
        description=(
            "Demo role used to exercise the proctored AI interview flow. "
            "Builds FastAPI services backed by PostgreSQL, Celery, and Redis."
        ),
        required_skills=["Python", "FastAPI", "PostgreSQL", "Celery"],
        experience_min=3,
        experience_max=7,
        interview_questions=INTERVIEW_QUESTIONS,
        voice_screening_enabled=False,
        status="active",
    )
    db.add(job)
    await db.flush()
    return job


async def _seed_candidate(
    db: AsyncSession,
    job: Job,
    *,
    token: str,
    name: str,
    email: str,
    status: str,
    reset: bool = False,
) -> InterviewSession:
    """Creates or re-arms one demo candidate and their interview link.

    With reset=True the session is returned to a never-attempted state: any
    generated report is deleted and every trace of a previous run is cleared.
    """
    now = datetime.now(timezone.utc)
    if reset:
        status = "pending"

    candidate = (
        await db.execute(
            select(Candidate).where(Candidate.job_id == job.id, Candidate.email == email)
        )
    ).scalars().first()
    if not candidate:
        candidate = Candidate(
            job_id=job.id,
            name=name,
            email=email,
            phone="+919000000001",
            pipeline_status="completed",
            status="active",
            years_experience=5.0,
            current_ctc="18 LPA",
            expected_ctc="26 LPA",
            notice_period="30 days",
        )
        db.add(candidate)
        await db.flush()

    # Interview routes require a passed screening call for the candidate+job.
    screening = (
        await db.execute(
            select(ScreeningCall).where(
                ScreeningCall.candidate_id == candidate.id,
                ScreeningCall.job_id == job.id,
            )
        )
    ).scalars().first()
    if not screening:
        db.add(
            ScreeningCall(
                candidate_id=candidate.id,
                job_id=job.id,
                call_status="completed",
                result="pass",
                call_outcome="completed",
                willingness_to_proceed=True,
                summary="Seeded screening pass for the proctoring demo.",
                interview_queued_at=now,
            )
        )
        await db.flush()

    session = (
        await db.execute(
            select(InterviewSession).where(InterviewSession.unique_token == token)
        )
    ).scalars().first()
    if not session:
        session = InterviewSession(
            candidate_id=candidate.id,
            job_id=job.id,
            unique_token=token,
        )
        db.add(session)

    if session.id is not None:
        # Drop any assessment generated by an earlier run of this link.
        await db.execute(
            InterviewReport.__table__.delete().where(
                InterviewReport.interview_session_id == session.id
            )
        )

    session.candidate_id = candidate.id
    session.job_id = job.id
    session.status = status
    session.hr_decision = "pending"
    session.email_sent_at = now
    session.expires_at = now + timedelta(days=7)
    session.scheduled_interview_at = None
    # Reset a previously-used demo link so the token is startable again.
    if status == "pending":
        session.started_at = None
        session.completed_at = None
        session.livekit_room_name = None
        session.egress_id = None
        session.recording_key = None
        session.recording_ready = None
        session.transcript = None
        session.transcript_segments = None
    else:
        session.started_at = now - timedelta(minutes=25)
        session.completed_at = now - timedelta(minutes=5)

    await db.flush()
    return session


async def seed(label: str, reset: bool = False) -> None:
    engine = create_async_engine(config.DATABASE_URL, echo=False)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        tenant = await _get_or_create_tenant(db)
        await _get_or_create_hr_user(db, tenant)
        title = job_title_for(label)
        job = await _get_or_create_job(db, tenant, title)

        links: list[tuple[str, str, str]] = []
        for index, (name, email, status) in enumerate(DEMO_CANDIDATES, start=1):
            token = token_for(label, index)
            await _seed_candidate(
                db, job, token=token, name=name, email=email, status=status, reset=reset
            )
            if reset:
                status = "pending"
            links.append((name, status, f"{config.CANDIDATE_APP_URL}/interview/{token}"))

        await db.commit()

    await engine.dispose()

    print("\nSeeded proctoring demo data")
    print(f"  Tenant : {TENANT_NAME} ({TENANT_SLUG})")
    print(f"  Job    : {title}")
    print(f"  HR login: {HR_EMAIL} / {HR_PASSWORD}")
    print("\nInterview links:")
    for name, status, url in links:
        print(f"  {name:<14} [{status:<9}] {url}")
    print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--label",
        default="demo",
        help="Seeds a separate job and its own set of links (default: demo).",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Wipe every trace of previous runs: all links go back to pending, "
        "reports are deleted, nothing looks attempted.",
    )
    args = parser.parse_args()
    asyncio.run(seed(args.label.strip().lower().replace(" ", "-") or "demo", args.reset))
