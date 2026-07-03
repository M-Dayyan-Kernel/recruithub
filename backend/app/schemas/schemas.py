import uuid
from datetime import datetime, time
from typing import Literal, Optional, List

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Job schemas
# ---------------------------------------------------------------------------

class InterviewQuestion(BaseModel):
    id: str
    question: str
    score: int = Field(gt=0)


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
        if isinstance(item, InterviewQuestion):
            q = item
        elif isinstance(item, dict):
            q = InterviewQuestion(
                id=item.get("id") or str(uuid.uuid4()),
                question=(item.get("question") or "").strip(),
                score=int(item.get("score") or 0),
            )
        else:
            continue
        if not q.question:
            raise ValueError("Each interview question must have non-empty question text")
        if q.score < 1:
            raise ValueError("Each interview question must have score >= 1")
        normalized.append(q.model_dump())
    return normalized


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
    interview_questions: List[InterviewQuestion] = []
    screening_call_from: Optional[time] = None
    screening_call_to: Optional[time] = None
    screening_timezone: str = "Asia/Kolkata"
    status: str
    created_at: datetime
    updated_at: datetime

    @field_validator("screening_questions", "interview_questions", mode="before")
    @classmethod
    def coerce_questions(cls, value):
        if value is None:
            return []
        return value

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
    interview_questions: List[InterviewQuestion] = []


# ---------------------------------------------------------------------------
# System settings schemas
# ---------------------------------------------------------------------------

class SystemSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    allowed_phone_regions: List[str]
    enforce_phone_geography: bool
    screening_max_retries: int
    screening_retry_delay_seconds: int
    updated_at: datetime


class SystemSettingsUpdate(BaseModel):
    allowed_phone_regions: Optional[List[str]] = None
    enforce_phone_geography: Optional[bool] = None
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


class InterviewPipelineCandidate(BaseModel):
    candidate_id: uuid.UUID
    candidate_name: Optional[str] = None
    tab: Literal["pending", "scheduled", "ongoing", "completed"]
    has_report: bool
    session: Optional[InterviewSessionResponse] = None


class InterviewPipelineResponse(BaseModel):
    counts: InterviewPipelineCounts
    candidates: List[InterviewPipelineCandidate]


# ---------------------------------------------------------------------------
# InterviewReport schemas
# ---------------------------------------------------------------------------

class InterviewQuestionScore(BaseModel):
    id: str
    question: str
    score: int
    earned_score: Optional[int] = None
    notes: Optional[str] = None


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
