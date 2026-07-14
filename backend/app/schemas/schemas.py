import uuid
from datetime import datetime, time
from typing import Literal, Optional, List

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Job schemas
# ---------------------------------------------------------------------------

class InterviewQuestionPublic(BaseModel):
    id: str
    question: str
    score: int = Field(gt=0)


class InterviewQuestion(InterviewQuestionPublic):
    expected_points: Optional[List[str]] = None


class ScreeningQuestion(BaseModel):
    id: str
    question: str


def _normalize_screening_questions(questions: Optional[List]) -> List[dict]:
    """Assign UUIDs to questions missing ids; validate non-empty text."""
    if not questions:
        return []
    normalized: List[dict] = []
    for item in questions:
        if isinstance(item, ScreeningQuestion):
            q = item
        elif isinstance(item, dict):
            q = ScreeningQuestion(
                id=item.get("id") or str(uuid.uuid4()),
                question=(item.get("question") or "").strip(),
            )
        else:
            continue
        if not q.question:
            raise ValueError("Each screening question must have non-empty question text")
        normalized.append(q.model_dump())
    return normalized


def _normalize_interview_questions(questions: Optional[List]) -> List[dict]:
    """Assign UUIDs to questions missing ids; validate non-empty text and score >= 1."""
    if not questions:
        return []
    normalized: List[dict] = []
    for item in questions:
        expected_points: Optional[List[str]] = None
        if isinstance(item, InterviewQuestion):
            q = item
            expected_points = q.expected_points
        elif isinstance(item, dict):
            raw_points = item.get("expected_points")
            if isinstance(raw_points, list):
                expected_points = [str(p).strip() for p in raw_points if str(p).strip()]
            q = InterviewQuestion(
                id=item.get("id") or str(uuid.uuid4()),
                question=(item.get("question") or "").strip(),
                score=int(item.get("score") or 0),
                expected_points=expected_points or None,
            )
        else:
            continue
        if not q.question:
            raise ValueError("Each interview question must have non-empty question text")
        if q.score < 1:
            raise ValueError("Each interview question must have score >= 1")
        from app.services.interview_question_constraints import (
            validate_oral_interview_question,
            validate_technical_interview_question,
        )

        validate_oral_interview_question(q.question)
        validate_technical_interview_question(q.question)
        dumped = q.model_dump()
        normalized.append(dumped)
    return normalized


def _strip_expected_points_from_questions(questions: Optional[List]) -> List[dict]:
    """Return interview questions without expected_points for public API responses."""
    if not questions:
        return []
    result: List[dict] = []
    for item in questions:
        if isinstance(item, InterviewQuestionPublic):
            result.append(item.model_dump())
        elif isinstance(item, InterviewQuestion):
            result.append(InterviewQuestionPublic(**item.model_dump()).model_dump())
        elif isinstance(item, dict):
            result.append(
                InterviewQuestionPublic(
                    id=str(item.get("id") or ""),
                    question=(item.get("question") or "").strip(),
                    score=int(item.get("score") or 0),
                ).model_dump()
            )
        else:
            continue
    return result


class JobCreate(BaseModel):
    title: str
    description: str
    required_skills: Optional[List[str]] = None
    experience_min: int = 0
    experience_max: int = 0
    screening_questions: List[ScreeningQuestion] = []
    interview_questions: List[InterviewQuestion] = []
    status: str = "active"

    @model_validator(mode="before")
    @classmethod
    def normalize_questions(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            if "interview_questions" in data:
                data["interview_questions"] = _normalize_interview_questions(data.get("interview_questions"))
            if "screening_questions" in data:
                data["screening_questions"] = _normalize_screening_questions(data.get("screening_questions"))
        return data


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[List[str]] = None
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    screening_questions: Optional[List[ScreeningQuestion]] = None
    interview_questions: Optional[List[InterviewQuestion]] = None
    screening_call_from: Optional[time] = None
    screening_call_to: Optional[time] = None
    screening_timezone: Optional[str] = None
    status: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_questions(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            if data.get("interview_questions") is not None:
                data["interview_questions"] = _normalize_interview_questions(data.get("interview_questions"))
            if data.get("screening_questions") is not None:
                data["screening_questions"] = _normalize_screening_questions(data.get("screening_questions"))
        return data


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str
    required_skills: Optional[List[str]] = None
    experience_min: int
    experience_max: int
    screening_questions: List[ScreeningQuestion] = []
    interview_questions: List[InterviewQuestionPublic] = []
    screening_call_from: Optional[time] = None
    screening_call_to: Optional[time] = None
    screening_timezone: str = "Asia/Kolkata"
    status: str
    created_at: datetime
    updated_at: datetime

    @field_validator("screening_questions", mode="before")
    @classmethod
    def coerce_screening_questions(cls, value):
        if value is None:
            return []
        return value

    @field_validator("interview_questions", mode="before")
    @classmethod
    def coerce_interview_questions(cls, value):
        if value is None:
            return []
        return _strip_expected_points_from_questions(value)

    @computed_field
    @property
    def interview_total_score(self) -> int:
        return sum(q.score for q in self.interview_questions)


class JobParseResponse(BaseModel):
    title: str
    description: str
    required_skills: List[str] = []
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    screening_questions: List[ScreeningQuestion] = []
    interview_questions: List[InterviewQuestionPublic] = []


# ---------------------------------------------------------------------------
# System settings schemas
# ---------------------------------------------------------------------------

class SystemSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    allowed_phone_regions: List[str]
    enforce_phone_geography: bool
    screening_enabled: bool
    screening_max_retries: int
    screening_retry_delay_seconds: int
    updated_at: datetime


class EmailTemplateEntry(BaseModel):
    subject: str
    body_html: str
    version: int = 1
    updated_at: Optional[str] = None


class EmailTemplatesResponse(BaseModel):
    templates: dict[str, EmailTemplateEntry]
    required_placeholders: dict[str, List[str]]


class EmailTemplateUpdate(BaseModel):
    subject: str
    body_html: str


class EmailTemplatePreviewRequest(BaseModel):
    subject: str
    body_html: str


class EmailTemplatePreviewResponse(BaseModel):
    subject: str
    body_html: str


class EmailTemplateTestRequest(BaseModel):
    to_email: str
    subject: str
    body_html: str


class SystemSettingsUpdate(BaseModel):
    allowed_phone_regions: Optional[List[str]] = None
    enforce_phone_geography: Optional[bool] = None
    screening_enabled: Optional[bool] = None
    screening_max_retries: Optional[int] = None
    screening_retry_delay_seconds: Optional[int] = None


# ---------------------------------------------------------------------------
# Screening trigger schemas
# ---------------------------------------------------------------------------

class ScreeningTriggerRequest(BaseModel):
    candidate_ids: List[str]
    force: bool = False


class ScreeningTriggerResponse(BaseModel):
    initiated: int
    queued: int = 0
    skipped: List[dict] = []


# ---------------------------------------------------------------------------
# Candidate schemas
# ---------------------------------------------------------------------------

class CandidateCreate(BaseModel):
    job_id: uuid.UUID
    name: str
    email: str
    phone: Optional[str] = None


class CandidateUpdate(BaseModel):
    """Partial update for a candidate's mutable contact fields."""
    phone: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None


class CandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    name: str
    email: str
    phone: Optional[str] = None
    resume_file_path: Optional[str] = None
    original_filename: Optional[str] = None  # Original upload filename
    resume_raw_text: Optional[str] = None
    parsed_data: Optional[dict] = None
    parse_status: str
    created_at: datetime


class ResumeUploadResponse(BaseModel):
    """Response for POST /api/jobs/{job_id}/resumes including dedup counts."""
    created: int
    skipped: int
    skipped_files: List[str]
    candidate_ids: List[str]
    extracted_from_zip: int = 0
    skipped_oversized: List[str] = []


# ---------------------------------------------------------------------------
# ShortlistResult schemas
# ---------------------------------------------------------------------------

class ShortlistResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    job_id: uuid.UUID
    match_score: float
    recommendation: str
    strengths: Optional[List[str]] = None
    gaps: Optional[List[str]] = None
    reason: Optional[str] = None
    hr_decision: str
    hr_feedback_type: Optional[str] = None
    hr_comments: Optional[str] = None
    created_at: datetime


class ShortlistResultWithCandidateResponse(ShortlistResultResponse):
    """ShortlistResultResponse enriched with candidate name and email.

    Used by GET /api/jobs/{job_id}/shortlist to avoid N+1 joins in the client.
    candidate_email is None if it is still a placeholder (ends with @upload.pending).
    """
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None


class ShortlistDecisionUpdate(BaseModel):
    hr_decision: str  # approved / rejected / overridden


class ShortlistDecisionResponse(ShortlistResultResponse):
    screening_skipped: bool = False
    interview_session_id: Optional[uuid.UUID] = None
    interview_email_sent: Optional[bool] = None


class ShortlistFeedbackCreate(BaseModel):
    hr_feedback_type: str  # correctly_shortlisted / incorrectly_shortlisted / correctly_rejected / incorrectly_rejected
    hr_comments: Optional[str] = None


class ShortlistTriggerRequest(BaseModel):
    """Optional body for POST /api/jobs/{job_id}/shortlist."""
    candidate_ids: Optional[List[uuid.UUID]] = None


class ShortlistStatusResponse(BaseModel):
    in_progress: bool
    candidate_ids: List[str]
    completed: int
    total: int
    failed: int = 0


# ---------------------------------------------------------------------------
# ScreeningCall schemas
# ---------------------------------------------------------------------------

class ScreeningCallResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    job_id: uuid.UUID
    vapi_call_id: Optional[str] = None
    call_status: str
    availability: Optional[str] = None
    employment_status: Optional[str] = None
    relevant_experience: Optional[str] = None
    current_ctc: Optional[str] = None
    expected_ctc: Optional[str] = None
    notice_period: Optional[str] = None
    location_preference: Optional[str] = None
    communication_quality: Optional[str] = None
    willingness_to_proceed: Optional[bool] = None
    summary: Optional[str] = None
    result: Optional[str] = None
    transcript: Optional[str] = None
    ended_reason: Optional[str] = None
    call_outcome: Optional[str] = None
    retry_count: int = 0
    interview_queued_at: Optional[datetime] = None
    has_interview_session: bool = False
    created_at: datetime


class ScreeningResultUpdate(BaseModel):
    """HR override of AI screening result."""
    result: str  # pass | fail | needs_review


# ---------------------------------------------------------------------------
# InterviewSession schemas
# ---------------------------------------------------------------------------

class InterviewSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    candidate_id: uuid.UUID
    job_id: uuid.UUID
    unique_token: str
    livekit_room_name: Optional[str] = None
    status: str
    hr_decision: str = "pending"  # pending | approved | rejected
    email_sent_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    scheduled_interview_at: Optional[datetime] = None
    created_at: datetime
    egress_id: Optional[str] = None  # LiveKit egress recording ID
    expires_at: Optional[datetime] = None  # Link expiry timestamp
    # Enriched fields (not stored on the model — set in route handlers)
    interview_url: Optional[str] = None
    candidate_name: Optional[str] = None
    job_title: Optional[str] = None
    mock_mode: bool = False


class InterviewHrDecisionUpdate(BaseModel):
    """HR approve/reject after a completed interview."""
    hr_decision: Literal["approved", "rejected"]


class InterviewScheduleRequest(BaseModel):
    """Schedule an AI interview for a specific date and time (job timezone)."""
    scheduled_date: str = Field(description="YYYY-MM-DD")
    scheduled_time: str = Field(description="HH:MM (24h)")
    timezone: str = Field(default="Asia/Kolkata", description="IANA timezone")


class InterviewStartResponse(BaseModel):
    """Returned when a candidate starts their interview — contains the LiveKit token."""
    room_name: str
    token: str
    livekit_url: str


class InterviewPipelineCounts(BaseModel):
    pending: int
    scheduled: int
    ongoing: int
    completed: int
    flagged: int = 0
    finalists: int = 0


class InterviewPipelineCandidate(BaseModel):
    candidate_id: uuid.UUID
    candidate_name: Optional[str] = None
    tab: Literal["pending", "scheduled", "ongoing", "completed", "flagged", "finalists"]
    has_report: bool
    session: Optional[InterviewSessionResponse] = None
    report_overall_score: Optional[float] = None
    report_recommendation: Optional[str] = None
    assessment_status: Literal["none", "generating", "ready", "failed"] = "none"
    flag_reason: Optional[str] = None
    can_reschedule: bool = False
    actions_disabled: bool = False
    has_active_session: bool = False
    hr_decision: Optional[str] = None


class InterviewPipelineResponse(BaseModel):
    counts: InterviewPipelineCounts
    candidates: List[InterviewPipelineCandidate]


class FinalistCandidate(BaseModel):
    candidate_id: uuid.UUID
    session_id: uuid.UUID
    candidate_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    current_ctc: Optional[str] = None
    expected_ctc: Optional[str] = None
    total_experience_years: Optional[float] = None
    report_overall_score: Optional[float] = None
    report_recommendation: Optional[str] = None
    hr_decision: str = "approved"
    completed_at: Optional[datetime] = None


class FinalistsResponse(BaseModel):
    candidates: List[FinalistCandidate]


# ---------------------------------------------------------------------------
# InterviewReport schemas
# ---------------------------------------------------------------------------

class PointCoverage(BaseModel):
    point: str
    covered: bool


class InterviewQuestionScore(BaseModel):
    id: str
    question: str
    score: int
    earned_score: Optional[int] = None
    notes: Optional[str] = None
    candidate_answer: Optional[str] = None
    expected_points: Optional[List[str]] = None
    candidate_points: Optional[List[str]] = None
    point_coverage: Optional[List[PointCoverage]] = None


class InterviewReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    interview_session_id: uuid.UUID
    candidate_id: uuid.UUID
    job_id: uuid.UUID
    summary: Optional[str] = None
    transcript_summary: Optional[str] = None
    technical_fit_score: Optional[float] = None
    communication_score: Optional[float] = None
    problem_solving_score: Optional[float] = None
    experience_score: Optional[float] = None
    role_alignment_score: Optional[float] = None
    overall_score: Optional[float] = None
    strengths: Optional[List[str]] = None
    weaknesses: Optional[List[str]] = None
    jd_fit: Optional[str] = None
    final_recommendation: Optional[str] = None
    raw_report: Optional[dict] = None
    created_at: datetime
    # Enriched fields — not stored on the model, populated by route handler via joins
    candidate_name: Optional[str] = None
    job_title: Optional[str] = None
    question_scores: Optional[List[InterviewQuestionScore]] = None
    rubric_total: Optional[int] = None
    transcript: Optional[str] = None


# ---------------------------------------------------------------------------
# Auth / User schemas (RBAC)
# ---------------------------------------------------------------------------

RoleLiteral = Literal["admin", "hr"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: RoleLiteral
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=6, max_length=128)
    role: RoleLiteral = "hr"


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=255)
    role: Optional[RoleLiteral] = None
    password: Optional[str] = Field(None, min_length=6, max_length=128)
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# Audit log schemas
# ---------------------------------------------------------------------------

class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    actor_user_id: Optional[uuid.UUID] = None
    actor_name: str
    actor_role: str
    action: str
    entity_type: str
    entity_id: Optional[uuid.UUID] = None
    subject_label: str
    feature: str
    before_state: Optional[dict] = None
    after_state: Optional[dict] = None
    job_id: Optional[uuid.UUID] = None


class AuditLogListResponse(BaseModel):
    items: List[AuditLogResponse]
    total: int
    limit: int
    offset: int
