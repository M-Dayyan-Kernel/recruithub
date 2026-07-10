import uuid
from datetime import datetime, time
from typing import Optional, List

from sqlalchemy import (
    String, Text, Integer, Float, Boolean, DateTime, ForeignKey, func, Time
)
from sqlalchemy.orm import relationship, mapped_column, Mapped
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSON
from pgvector.sqlalchemy import Vector

from app.core.database import Base


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    required_skills: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    experience_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    experience_max: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    screening_questions: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    interview_questions: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    screening_call_from: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    screening_call_to: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    screening_timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Kolkata", server_default="Asia/Kolkata")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
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
    resume_raw_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    parsed_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    resume_embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(1536), nullable=True)
    parse_status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending_parse")
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    allowed_phone_regions: Mapped[List[str]] = mapped_column(JSON, nullable=False, default=list)
    enforce_phone_geography: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    screening_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    screening_max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=3, server_default="3")
    screening_retry_delay_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1800, server_default="1800"
    )
    email_templates: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    unique_token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    livekit_room_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="pending")
    email_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    egress_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # LiveKit egress recording ID
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)  # Link expiry (7 days from send)
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

    # Relationships
    session: Mapped["InterviewSession"] = relationship("InterviewSession", back_populates="report")
