import uuid
from datetime import datetime, time, date
from typing import Optional, List

from sqlalchemy import (
    String, Text, Integer, Float, Boolean, DateTime, Date, ForeignKey, Index, UniqueConstraint, func, literal_column, text, Time
)
from sqlalchemy.orm import relationship, mapped_column, Mapped
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSON

from app.core.constants import ORG_NAME_UNIQUE_INDEX
from app.core.database import Base


# Case- and whitespace-insensitive identity of a tenant name. One string is the
# single source for the unique index below and for TenantRepository.name_exists,
# so the two can never drift apart. Mirrors ``org_name_key`` in core/tenancy.py.
# It is a constant (not bound parameters) so the planner can match a query's
# expression to the index.
_TENANT_NAME_KEY_SQL = r"lower(regexp_replace(btrim({col}), '\s+', ' ', 'g'))"


def tenant_name_key():
    """SQL expression for a tenant name's identity, for ``WHERE`` clauses."""
    return literal_column(_TENANT_NAME_KEY_SQL.format(col="tenants.name"))


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # pending | approved | rejected — self-signup orgs start as pending until superadmin reviews
    verification_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="approved", server_default="approved"
    )
    company_registration_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    gst_document_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    gst_document_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        # Two organizations may not share a name, however it is cased or spaced.
        # Backstop for concurrent creates; the services check first so the user
        # gets a clean error rather than relying on this.
        Index(
            ORG_NAME_UNIQUE_INDEX,
            text(_TENANT_NAME_KEY_SQL.format(col="name")),
            unique=True,
        ),
    )

    # passive_deletes: DB ON DELETE CASCADE clears children; without it SQLAlchemy
    # tries to SET NULL on non-nullable FKs (e.g. system_settings.tenant_id).
    users: Mapped[List["User"]] = relationship(
        "User", back_populates="tenant", cascade="all, delete-orphan", passive_deletes=True
    )
    jobs: Mapped[List["Job"]] = relationship(
        "Job", back_populates="tenant", cascade="all, delete-orphan", passive_deletes=True
    )
    settings: Mapped[Optional["SystemSettings"]] = relationship(
        "SystemSettings",
        back_populates="tenant",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    invites: Mapped[List["TenantInvite"]] = relationship(
        "TenantInvite",
        back_populates="tenant",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class TenantInvite(Base):
    __tablename__ = "tenant_invites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="hr")  # "admin" | "hr"
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    invited_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="invites")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # "superadmin" | "admin" | "hr"
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    mfa_secret: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="users")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    required_skills: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    experience_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    experience_max: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # remote | hybrid | onsite; NULL on jobs created before work modes existed.
    work_mode: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    # One short line; set for hybrid and onsite jobs only.
    work_location: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    screening_questions: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    interview_questions: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    screening_call_from: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    screening_call_to: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    screening_timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Kolkata", server_default="Asia/Kolkata")
    voice_screening_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    # The AI-extension check for this job's interviews. The mode is kept while the check is off,
    # so turning it back on restores it. A new job starts on, in shadow mode.
    extension_check_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    extension_check_mode: Mapped[str] = mapped_column(
        String(10), nullable=False, default="shadow", server_default="shadow"
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    @property
    def effective_screening_questions(self) -> list[dict]:
        """What a call asks: the locked standard questions plus the stored role and custom ones."""
        from app.services.screening_defaults import effective_screening_questions

        return effective_screening_questions(self)

    # Relationships
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="jobs")
    candidates: Mapped[List["Candidate"]] = relationship("Candidate", back_populates="job", cascade="all, delete-orphan")
    shortlist_results: Mapped[List["ShortlistResult"]] = relationship("ShortlistResult", back_populates="job", cascade="all, delete-orphan")
    screening_calls: Mapped[List["ScreeningCall"]] = relationship("ScreeningCall", back_populates="job", cascade="all, delete-orphan")
    interview_sessions: Mapped[List["InterviewSession"]] = relationship("InterviewSession", back_populates="job", cascade="all, delete-orphan")


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    resume_file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    original_filename: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)  # Original upload filename — used for dedup check
    parsed_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    pipeline_status: Mapped[str] = mapped_column(String(50), nullable=False, default="queued")
    pipeline_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    processing_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active", server_default="active")
    years_experience: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current_ctc: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    expected_ctc: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notice_period: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    last_working_day: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="candidates")
    shortlist_results: Mapped[List["ShortlistResult"]] = relationship("ShortlistResult", back_populates="candidate", cascade="all, delete-orphan")
    screening_calls: Mapped[List["ScreeningCall"]] = relationship("ScreeningCall", back_populates="candidate", cascade="all, delete-orphan")
    interview_sessions: Mapped[List["InterviewSession"]] = relationship("InterviewSession", back_populates="candidate", cascade="all, delete-orphan")


class ShortlistResult(Base):
    __tablename__ = "shortlist_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    match_score: Mapped[float] = mapped_column(Float, nullable=False)
    recommendation: Mapped[str] = mapped_column(String(50), nullable=False)
    strengths: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    gaps: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hr_decision: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    hr_feedback_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    hr_comments: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    model_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    prompt_version: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # Rejection record: `hr_decision == 'rejected'` stays THE marker; these say where from,
    # who/when, whether the candidate has been told, and what Reconsider restores.
    rejected_from: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # resume | phone | interview
    rejected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rejection_email_claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_emailed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reconsider_state: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    candidate: Mapped["Candidate"] = relationship("Candidate", back_populates="shortlist_results")
    job: Mapped["Job"] = relationship("Job", back_populates="shortlist_results")


class ScreeningCall(Base):
    __tablename__ = "screening_calls"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    vapi_call_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    call_status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    availability: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    employment_status: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    relevant_experience: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    current_ctc: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    expected_ctc: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notice_period: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    location_preference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    communication_quality: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    willingness_to_proceed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    result: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ended_reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    call_outcome: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # call_outcome values: "completed" | "no_answer" | "voicemail" | "declined" | "dropped" | "failed"
    interview_queued_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_attempt_email_sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    failed_attempt_email_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    candidate: Mapped["Candidate"] = relationship("Candidate", back_populates="screening_calls")
    job: Mapped["Job"] = relationship("Job", back_populates="screening_calls")


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    allowed_phone_regions: Mapped[List[str]] = mapped_column(JSON, nullable=False, default=list)
    enforce_phone_geography: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    screening_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    screening_max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=3, server_default="3")
    screening_retry_delay_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1800, server_default="1800"
    )
    email_templates: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    company_name: Mapped[str] = mapped_column(
        String(255), nullable=False, default="Webknot Technologies", server_default="Webknot Technologies"
    )
    integrations: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    data_retention_days: Mapped[int] = mapped_column(
        Integer, nullable=False, default=365, server_default="365"
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="settings")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    unique_token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    livekit_room_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    hr_decision: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    email_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    transcript_segments: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    egress_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # LiveKit egress recording ID
    recording_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)  # S3 object key for egress recording
    recording_ready: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)  # True after egress_ended webhook
    # What the AI-extension check was set to for this interview, stamped when it starts and
    # refreshed on each policy fetch and accepted scan. Null on interviews that predate it.
    extension_check_enabled: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    extension_check_mode: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    extension_policy_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    video_proctoring_job_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    video_proctoring_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    video_proctoring_result: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    video_proctoring_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)  # Link expiry (session_link_ttl_days after the send time, or after the scheduled slot)
    scheduled_interview_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rescheduled_from_session_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    candidate: Mapped["Candidate"] = relationship("Candidate", back_populates="interview_sessions")
    job: Mapped["Job"] = relationship("Job", back_populates="interview_sessions")
    report: Mapped[Optional["InterviewReport"]] = relationship("InterviewReport", back_populates="session", uselist=False, cascade="all, delete-orphan")


class InterviewReport(Base):
    __tablename__ = "interview_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False)
    candidate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    transcript_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    technical_fit_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    communication_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    problem_solving_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    experience_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    role_alignment_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    strengths: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    weaknesses: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    jd_fit: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    final_recommendation: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    raw_report: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="report")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PasswordToken(Base):
    """One-time link for setting or resetting a password.

    Only the SHA-256 of the token is stored. A row is spent by stamping
    ``used_at`` in the same UPDATE that validates it, so a link cannot be
    redeemed twice even under concurrent requests.
    """

    __tablename__ = "password_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)  # "onboarding" | "reset"
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ExtensionBlocklistEntry(Base):
    """A known AI-assistant browser extension that may not be enabled during an interview.

    One list per organization, edited by its Admins (HR can view it). A new organization starts
    with a copy of the platform's default entries (`origin = "default"`); entries an admin adds
    are `custom`. The ID comes from the extension's own Chrome Web Store listing.
    """

    __tablename__ = "extension_blocklist"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    extension_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)  # ai_assistant | interview_assistant
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    listing_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active", server_default="active")
    origin: Mapped[str] = mapped_column(String(10), nullable=False, default="custom", server_default="custom")
    verified_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "extension_id", name="uq_extension_blocklist_tenant_extension"),
        # The interview page reads one organization's active entries.
        Index("ix_extension_blocklist_tenant_status", "tenant_id", "status"),
    )


class ExtensionOrgPolicy(Base):
    """One organization's extension-check state: a version that changes whenever its blocklist
    does, and the marker that its starting entries were copied in.

    The on/off switch and mode live on each job; there are no organization-wide defaults for
    them. `blocklist_seeded_at` records that the default entries were copied in, so an
    organization that deletes them all is not seeded again. The heuristic rules are platform
    defaults in code, not stored here.
    """

    __tablename__ = "extension_org_policy"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    blocklist_seeded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    updated_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class ObservedExtension(Base):
    """An extension that was flagged on some candidate's browser, one row per extension.

    A catalog, per organization, for its Admins to decide from. It deliberately holds no
    candidate, interview, job or user reference: only the organization it belongs to, facts
    about the extension itself and how often it has been seen there.

    A dismissal remembers what the extension looked like at the time
    (`dismissed_hash`, `dismissed_reason`) so it can reopen if it changes.
    """

    __tablename__ = "observed_extensions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )
    extension_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    strongest_reason: Mapped[str] = mapped_column(String(20), nullable=False)
    times_seen: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="new", server_default="new")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Every distinct name+description variant seen (capped). Chrome localizes both,
    # so one fingerprint would reopen a dismissal for a candidate who simply uses
    # another browser language; only a variant never seen before counts as a change.
    known_hashes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    dismissed_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    dismissed_reason: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    dismissed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    dismissed_by_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reopened_reason: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "extension_id", name="uq_observed_extensions_tenant_extension"),
        # An organization's list pages by status and recency.
        Index("ix_observed_extensions_tenant_status_last_seen", "tenant_id", "status", "last_seen_at"),
    )


class InterviewIntegrityScan(Base):
    """One extension scan taken during an interview (append-only evidence for HR)."""

    __tablename__ = "interview_integrity_scans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    interview_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phase: Mapped[str] = mapped_column(String(20), nullable=False)  # preflight | final | start
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)  # clear | flagged | blocked | unavailable
    flagged: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    flagged_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    policy_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    mode: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    error_code: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    client_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    tenant_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    subject_label: Mapped[str] = mapped_column(String(500), nullable=False)
    feature: Mapped[str] = mapped_column(String(100), nullable=False)
    before_state: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    after_state: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    candidate_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
