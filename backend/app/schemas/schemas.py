import re
import uuid
from datetime import date, datetime, time
from typing import Literal, Optional, List

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from app.core.screening_skipped import is_skipped_screening
from app.models.enums import SeniorityLevel
from app.schemas.integrity import IntegritySummary
from app.services.screening_defaults import (
    MAX_SCREENING_QUESTION_CHARS,
    MAX_SCREENING_QUESTIONS,
    MAX_WORK_LOCATION_CHARS,
    validate_work_location,
)


_PASSWORD_MIN_LEN = 12
_PASSWORD_PATTERN = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?\":{}|<>_\-\[\]\\/+=~`]).+$"
)

# Name fields are stored in String(255) columns, but these are names — not prose.
# Capped well below the column width so a pasted paragraph is rejected.
# Keep in sync with `hr-app/src/lib/validation.ts`.
_ORG_NAME_MAX_LEN = 100
_PERSON_NAME_MAX_LEN = 80


def validate_password_strength(password: str) -> str:
    if len(password) < _PASSWORD_MIN_LEN:
        raise ValueError(f"Password must be at least {_PASSWORD_MIN_LEN} characters")
    if not _PASSWORD_PATTERN.match(password):
        raise ValueError(
            "Password must include uppercase, lowercase, a digit, and a special character"
        )
    return password


def strip_required_text(value: str) -> str:
    """Trim a required name field.

    `Field(min_length=1)` runs before this, so whitespace-only input would
    otherwise reach the service layer, which strips it down to an empty name.
    """
    stripped = value.strip()
    if not stripped:
        raise ValueError("Value cannot be blank")
    return stripped


def strip_optional_text(value: Optional[str]) -> Optional[str]:
    """Trim an optional name field, rejecting whitespace-only input."""
    if value is None:
        return None
    return strip_required_text(value)


# ---------------------------------------------------------------------------
# Job schemas
# ---------------------------------------------------------------------------

#: Limits on a topic's text. Keep in sync with the web client.
TOPIC_NAME_MAX = 120
TOPIC_SCOPE_MAX = 500
TOPIC_SKILL_MAX = 60
TOPIC_QUESTION_MAX = 600


def _clean_topic_text(value: str, label: str, max_length: int) -> str:
    text = " ".join((value or "").split())
    if not text:
        raise ValueError(f"Each interview topic needs a {label}")
    if len(text) > max_length:
        raise ValueError(f"A topic's {label} can be at most {max_length} characters")
    return text


class InterviewTopicIn(BaseModel):
    """A topic as HR edits it. A new topic has no id yet."""

    id: Optional[uuid.UUID] = None
    name: str
    scope: str
    skill_tag: str
    seed_question: str
    is_mandatory: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _clean_topic_text(value, "name", TOPIC_NAME_MAX)

    @field_validator("scope")
    @classmethod
    def _scope(cls, value: str) -> str:
        return _clean_topic_text(value, "scope", TOPIC_SCOPE_MAX)

    @field_validator("skill_tag")
    @classmethod
    def _skill_tag(cls, value: str) -> str:
        return _clean_topic_text(value, "skill", TOPIC_SKILL_MAX).lower()

    @field_validator("seed_question")
    @classmethod
    def _seed_question(cls, value: str) -> str:
        from app.services.interview_question_constraints import (
            validate_oral_interview_question,
            validate_technical_interview_question,
        )

        question = _clean_topic_text(value, "example question", TOPIC_QUESTION_MAX)
        validate_oral_interview_question(question)
        validate_technical_interview_question(question)
        return question


class InterviewTopic(InterviewTopicIn):
    """A saved topic, as the API returns it (never with its answer key)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


WorkMode = Literal["remote", "hybrid", "onsite"]
#: Per job: shadow blocks blocklisted extensions and only records look-alikes; enforce also blocks strong look-alikes.
ExtensionCheckMode = Literal["shadow", "enforce"]


class ScreeningQuestion(BaseModel):
    id: str
    question: str
    # standard: locked and built by the server; role: written by the JD parser; custom: added by
    # HR. Rows stored before kinds existed read as custom (the server regenerates the standard
    # ones from their ids).
    kind: Literal["standard", "role", "custom"] = "custom"


#: Sanity cap for a candidate's years of experience; mirrored in the web client.
EXPERIENCE_MAX_YEARS = 60


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
                kind=item.get("kind") if item.get("kind") in ("standard", "role", "custom") else "custom",
            )
        else:
            continue
        if not q.question:
            raise ValueError("Each screening question must have non-empty question text")
        normalized.append(q.model_dump())
    return normalized


def _normalize_interview_topics(topics: Optional[List]) -> List[dict]:
    """Check a job's topic pool as a whole: size, mandatory limit, and no repeated topic.

    An empty pool is allowed (the job then has no topics to interview on); a non-empty one has
    to be big enough that different candidates really get different interviews.
    """
    if not topics:
        return []
    from app.core.config_loader import config

    pool = config.parsing.topic_pool
    normalized: List[dict] = []
    seen_ids: set = set()
    seen_names: set = set()
    for item in topics:
        topic = item if isinstance(item, InterviewTopicIn) else InterviewTopicIn.model_validate(item)
        topic_id = topic.id or uuid.uuid4()
        if topic_id in seen_ids:
            raise ValueError("The same interview topic appears twice")
        seen_ids.add(topic_id)
        key = topic.name.lower()
        if key in seen_names:
            raise ValueError(f"The interview topic '{topic.name}' appears twice")
        seen_names.add(key)
        normalized.append({**topic.model_dump(), "id": topic_id})
    if len(normalized) < pool.min:
        raise ValueError(f"An interview topic pool needs at least {pool.min} topics")
    if len(normalized) > pool.max:
        raise ValueError(f"An interview topic pool can have at most {pool.max} topics")
    if sum(1 for t in normalized if t["is_mandatory"]) > pool.max_mandatory:
        raise ValueError(f"At most {pool.max_mandatory} topics can be marked as asked in every interview")
    return normalized


class JobCreate(BaseModel):
    title: str
    description: str
    required_skills: Optional[List[str]] = None
    # Required: HR confirms the level the JD parser suggests. It sets question difficulty.
    seniority_level: SeniorityLevel
    # Required: the screening call's location question is built from it. The location is required
    # for hybrid and on-site jobs and dropped for remote ones.
    work_mode: WorkMode
    work_location: Optional[str] = None
    # Only the role and custom questions: the standard ones are the server's, so they are never
    # taken from here. None or [] both mean "no extra questions".
    screening_questions: Optional[List[ScreeningQuestion]] = None
    interview_topics: List[InterviewTopicIn] = []
    voice_screening_enabled: bool = True
    # The AI-extension check starts on, in shadow mode; the recruiter can turn it off here and
    # change the mode later on the job.
    extension_check_enabled: bool = True
    extension_check_mode: ExtensionCheckMode = "shadow"
    status: str = "active"

    @model_validator(mode="before")
    @classmethod
    def normalize_questions(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            if "interview_topics" in data:
                data["interview_topics"] = _normalize_interview_topics(data.get("interview_topics"))
            if data.get("screening_questions") is not None:
                data["screening_questions"] = _normalize_screening_questions(data.get("screening_questions"))
        return data

    @model_validator(mode="after")
    def check_work_location(self):
        self.work_location = validate_work_location(self.work_mode, self.work_location)
        return self


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[List[str]] = None
    seniority_level: Optional[SeniorityLevel] = None
    # An explicit null work_mode is refused by JobService.update: a mode cannot be un-set. The
    # location is checked there too, against the mode the job will have.
    work_mode: Optional[WorkMode] = None
    work_location: Optional[str] = None
    screening_questions: Optional[List[ScreeningQuestion]] = None
    interview_topics: Optional[List[InterviewTopicIn]] = None
    screening_call_from: Optional[time] = None
    screening_call_to: Optional[time] = None
    screening_timezone: Optional[str] = None
    voice_screening_enabled: Optional[bool] = None
    extension_check_enabled: Optional[bool] = None
    extension_check_mode: Optional[ExtensionCheckMode] = None
    status: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_questions(cls, data):
        if isinstance(data, dict):
            data = dict(data)
            if data.get("interview_topics") is not None:
                data["interview_topics"] = _normalize_interview_topics(data.get("interview_topics"))
            if data.get("screening_questions") is not None:
                data["screening_questions"] = _normalize_screening_questions(data.get("screening_questions"))
        return data


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str
    required_skills: Optional[List[str]] = None
    seniority_level: SeniorityLevel
    work_mode: Optional[str] = None
    work_location: Optional[str] = None
    # Read from Job.effective_screening_questions, so a legacy job's list comes out as the
    # standard questions plus its role and custom ones.
    screening_questions: List[ScreeningQuestion] = Field(
        default=[],
        validation_alias=AliasChoices("effective_screening_questions", "screening_questions"),
    )
    interview_topics: List[InterviewTopic] = []
    screening_call_from: Optional[time] = None
    screening_call_to: Optional[time] = None
    screening_timezone: str = "Asia/Kolkata"
    voice_screening_enabled: bool = True
    extension_check_enabled: bool = True
    extension_check_mode: str = "shadow"
    status: str
    created_at: datetime
    updated_at: datetime

    @field_validator("screening_questions", mode="before")
    @classmethod
    def coerce_screening_questions(cls, value):
        if value is None:
            return []
        return value


class JobParseResponse(BaseModel):
    title: str
    description: str
    required_skills: List[str] = []
    # The parser's suggestion; HR confirms it before the job is created.
    seniority_level: SeniorityLevel = SeniorityLevel.MID
    # Null when the JD does not say: HR chooses before the job can be created.
    work_mode: Optional[WorkMode] = None
    work_location: Optional[str] = None
    # The JD parser's role-specific questions only (at most two); the standard ones come from
    # the standard-questions preview.
    screening_questions: List[ScreeningQuestion] = []
    # The topic pool the parser proposes; HR reviews it before the job is created.
    interview_topics: List[InterviewTopicIn] = []


class InterviewTopicsRequest(BaseModel):
    """What the topic writer needs to know about a job, saved or not."""

    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    required_skills: List[str] = []
    seniority_level: SeniorityLevel


class InterviewTopicsResponse(BaseModel):
    topics: List[InterviewTopicIn]


class InterviewTopicRegenerateRequest(InterviewTopicsRequest):
    """Replace one topic of the pool being edited with a fresh one on the same skill area."""

    topics: List[InterviewTopicIn] = Field(min_length=1)
    #: Position of the topic to replace in `topics`.
    topic_index: int = Field(ge=0)

    @model_validator(mode="after")
    def index_in_range(self):
        if self.topic_index >= len(self.topics):
            raise ValueError("topic_index is outside the topic list")
        return self


class InterviewTopicRegenerateResponse(BaseModel):
    topic: InterviewTopicIn


class StandardScreeningQuestionsResponse(BaseModel):
    """The locked questions for a job being created or edited, and the limits that apply."""

    standard: List[ScreeningQuestion]
    max_total: int = MAX_SCREENING_QUESTIONS
    max_chars: int = MAX_SCREENING_QUESTION_CHARS
    max_location_chars: int = MAX_WORK_LOCATION_CHARS


# ---------------------------------------------------------------------------
# System settings schemas
# ---------------------------------------------------------------------------

def _interview_link_ttl_days() -> int:
    from app.core.config_loader import config

    return config.interview.session_link_ttl_days


class SystemSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    allowed_phone_regions: List[str]
    enforce_phone_geography: bool
    screening_enabled: bool
    screening_max_retries: int
    screening_retry_delay_seconds: int
    company_name: str = "Webknot Technologies"
    # Read-only: the platform-wide interview link validity (config.yaml), shown to admins.
    interview_link_ttl_days: int = Field(
        default_factory=lambda: _interview_link_ttl_days()
    )
    updated_at: datetime


class EmailTemplateEntry(BaseModel):
    subject: str
    body_html: str
    version: int = 1
    updated_at: Optional[str] = None


class EmailTemplatesResponse(BaseModel):
    templates: dict[str, EmailTemplateEntry]
    # Details each email has data for. Offered to the editor; never enforced.
    placeholders: dict[str, List[str]]
    common_placeholders: List[str] = ["{{company_name}}"]
    company_name: str = "Webknot Technologies"


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
    # No company_name: it is the name emails sign off with, set when the organisation is
    # created, and an organisation admin must not be able to put another company's name there.


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


#: Statuses HR can set by hand. (Pipeline stages are derived, not stored here.) "rejected"
#: is accepted but carried out as a rejection (see CandidateService.update); "on_hold" is
#: retired and read as "active".
CANDIDATE_STATUSES = ("active", "rejected", "hired")
#: Suffix of the stand-in address created when a resume has no email. It means
#: "email missing", so it is never a valid value for HR to save.
PLACEHOLDER_EMAIL_SUFFIX = "@upload.pending"

# Column limits in models.Candidate; checked here so an over-long value is a
# 422 with a message instead of a database error.
_CANDIDATE_NAME_MAX = 255
_CANDIDATE_EMAIL_MAX = 254
_CANDIDATE_PHONE_MAX = 50
_CANDIDATE_FREE_TEXT_MAX = 100
_PHONE_ALLOWED = re.compile(r"^\+?[\d\s().\-]+$")
_PHONE_MIN_DIGITS, _PHONE_MAX_DIGITS = 7, 15  # E.164 allows at most 15


class CandidateUpdate(BaseModel):
    """Partial update for a candidate's mutable fields.

    A field left out (or null) is "unchanged". A field that is sent must be
    valid: name and email are the candidate's identity and contact point (both
    NOT NULL), so they can never be blanked or set to something malformed.
    """
    phone: Optional[str] = None
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    status: Optional[str] = None
    years_experience: Optional[float] = None
    current_ctc: Optional[str] = None
    expected_ctc: Optional[str] = None
    notice_period: Optional[str] = None
    last_working_day: Optional[date] = None

    @field_validator("name")
    @classmethod
    def _name_required_when_sent(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        name = re.sub(r"\s+", " ", v).strip()
        if not name:
            raise ValueError("Name cannot be blank")
        if len(name) > _CANDIDATE_NAME_MAX:
            raise ValueError(f"Name must be at most {_CANDIDATE_NAME_MAX} characters")
        return name

    @field_validator("email")
    @classmethod
    def _email_must_be_real(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        email = str(v).strip().lower()
        if len(email) > _CANDIDATE_EMAIL_MAX:
            raise ValueError("Email is too long")
        if email.endswith(PLACEHOLDER_EMAIL_SUFFIX):
            raise ValueError("Enter the candidate's real email address")
        return email

    @field_validator("phone")
    @classmethod
    def _phone_format(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        phone = v.strip()
        if not phone:
            return None  # blank means "not provided", never an empty stored value
        digits = re.sub(r"\D", "", phone)
        if (
            len(phone) > _CANDIDATE_PHONE_MAX
            or not _PHONE_ALLOWED.match(phone)
            or not _PHONE_MIN_DIGITS <= len(digits) <= _PHONE_MAX_DIGITS
        ):
            raise ValueError(
                f"Enter a valid phone number ({_PHONE_MIN_DIGITS}-{_PHONE_MAX_DIGITS} digits)"
            )
        return phone

    @field_validator("status")
    @classmethod
    def _status_known(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v == "on_hold":
            return "active"  # retired: nothing acted on it; old clients still send it
        if v not in CANDIDATE_STATUSES:
            raise ValueError(f"Status must be one of: {', '.join(CANDIDATE_STATUSES)}")
        return v

    @field_validator("years_experience")
    @classmethod
    def _years_in_range(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        if not 0 <= v <= EXPERIENCE_MAX_YEARS:
            raise ValueError(f"Years of experience must be between 0 and {EXPERIENCE_MAX_YEARS}")
        return v

    @field_validator("current_ctc", "expected_ctc", "notice_period")
    @classmethod
    def _free_text_length(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        text = v.strip()
        if len(text) > _CANDIDATE_FREE_TEXT_MAX:
            raise ValueError(f"Must be at most {_CANDIDATE_FREE_TEXT_MAX} characters")
        return text or None


class CandidateResponse(BaseModel):
    """Summary candidate fields for list views (no resume body or storage paths)."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    name: str
    email: str
    phone: Optional[str] = None
    original_filename: Optional[str] = None
    pipeline_status: str
    status: str = "active"
    years_experience: Optional[float] = None
    current_ctc: Optional[str] = None
    expected_ctc: Optional[str] = None
    notice_period: Optional[str] = None
    last_working_day: Optional[date] = None
    created_at: datetime


class CandidateDetailResponse(CandidateResponse):
    """Full candidate detail including parsed resume data (HR/admin only)."""
    resume_file_path: Optional[str] = None
    parsed_data: Optional[dict] = None
    pipeline_error: Optional[str] = None


class CandidateListItem(BaseModel):
    """Tenant-wide candidate directory list row."""
    id: uuid.UUID
    job_id: uuid.UUID
    job_title: str
    name: str
    email: str
    phone: Optional[str] = None
    years_experience: Optional[float] = None
    current_ctc: Optional[str] = None
    expected_ctc: Optional[str] = None
    notice_period: Optional[str] = None
    last_working_day: Optional[date] = None
    hiring_stage: str
    match_score: Optional[float] = None
    status: str
    date_applied: datetime
    pipeline_status: str


class CandidateProfileResponse(CandidateListItem):
    """Full candidate profile for the directory module."""
    parsed_data: Optional[dict] = None
    resume_file_path: Optional[str] = None
    pipeline_error: Optional[str] = None
    shortlist: Optional["ShortlistResultResponse"] = None
    screening: Optional["ScreeningCallResponse"] = None
    interview_sessions: List["InterviewSessionResponse"] = []
    timeline: List["AuditLogResponse"] = []


class ResumeUploadResponse(BaseModel):
    """Response for POST /api/jobs/{job_id}/resumes including dedup counts."""
    created: int
    skipped: int
    skipped_files: List[str]
    candidate_ids: List[str]
    extracted_from_zip: int = 0
    skipped_oversized: List[str] = []
    worker_warning: Optional[str] = None


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
    model_name: Optional[str] = None
    prompt_version: Optional[str] = None
    created_at: datetime


class ShortlistStage(BaseModel):
    """Where an approved candidate is now. `kind` + `state` is what the UI words;
    `scheduled_at` is only set for interviews."""

    kind: Literal["screening", "interview"]
    state: str
    scheduled_at: Optional[datetime] = None
    # Why a screening is flagged, in a sentence HR can read.
    reason: Optional[str] = None


class ShortlistResultWithCandidateResponse(ShortlistResultResponse):
    """ShortlistResultResponse enriched with candidate name and email.

    Used by GET /api/jobs/{job_id}/shortlist to avoid N+1 joins in the client.
    candidate_email is None if it is still a placeholder (ends with @upload.pending).
    """
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    # Set only for approved candidates: where they are now (see shortlist_stage_service).
    stage: Optional[ShortlistStage] = None


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
    force: bool = False


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

    @computed_field
    @property
    def skipped(self) -> bool:
        return is_skipped_screening(
            call_status=self.call_status,
            vapi_call_id=self.vapi_call_id,
            ended_reason=self.ended_reason,
            summary=self.summary,
        )


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
    # 1..interview.max_rounds. A voided round keeps its number; its retake shares it.
    round_number: int = 1
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    email_sent_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    scheduled_interview_at: Optional[datetime] = None
    created_at: datetime
    egress_id: Optional[str] = None  # LiveKit egress recording ID
    recording_key: Optional[str] = None  # S3 object key for egress recording
    expires_at: Optional[datetime] = None  # Link expiry timestamp
    # Enriched fields (not stored on the model — set in route handlers)
    interview_url: Optional[str] = None
    candidate_name: Optional[str] = None
    job_title: Optional[str] = None
    mock_mode: bool = False
    capacity_available: Optional[bool] = None
    retry_after_minutes: Optional[int] = None


class InterviewVoidRequest(BaseModel):
    """Void the current taken round so the candidate can retake it."""

    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def reason_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Give a reason for voiding this round.")
        return value


class VoiceScreeningCandidate(BaseModel):
    candidate_id: uuid.UUID
    name: str
    # The Resume Screening stage state: queued / scheduled / retrying / flagged / cancelled.
    state: str


class VoiceScreeningPreview(BaseModel):
    """What switching voice screening on or off would do to this job's candidates."""
    enabled: bool
    # Turning off: approved candidates still waiting in the phone round. They must be sent
    # somewhere, so the switch asks where.
    in_phone_round: List[VoiceScreeningCandidate] = []
    # On a call right now: it finishes normally whatever is chosen.
    live_calls: int = 0
    # Have a finished call (passed, failed, needs review): they keep their result.
    with_call_result: int = 0
    # Already have an interview link: not affected either way.
    in_interviews: int = 0


class VoiceScreeningChange(BaseModel):
    enabled: bool
    # Required when turning off while candidates are in the phone round.
    move_to: Optional[Literal["interview", "resume"]] = None


class VoiceScreeningChangeResult(BaseModel):
    enabled: bool
    move_to: Optional[Literal["interview", "resume"]] = None
    moved: int = 0
    links_sent: int = 0
    # Moved to an interview but the email did not go out (no address, mail failure).
    email_failed: List[str] = []
    # Could not be moved at all; running the change again retries them.
    failed: List[str] = []
    live_calls: int = 0
    # A large phone round: this many are being moved after the response (see
    # voice_screening_service.INLINE_LIMIT). Anyone that fails there is still waiting.
    in_background: int = 0


class InterviewCancelRequest(BaseModel):
    """Cancel a pending interview link. `notify_candidate` sends the "interview cancelled" email."""
    notify_candidate: bool = False


class InterviewCancelResponse(BaseModel):
    session_id: uuid.UUID
    status: str
    # None when no email was asked for; otherwise whether it went out.
    email_sent: Optional[bool] = None


class PhoneRoundAdvanceRequest(BaseModel):
    candidate_id: uuid.UUID
    # Why the call is being skipped; kept in the audit trail and on the bypass record.
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason", mode="before")
    @classmethod
    def _strip(cls, value):
        # "   " is not a reason; measure what is left after trimming.
        return value.strip() if isinstance(value, str) else value


class PhoneRoundRejectRequest(BaseModel):
    candidate_id: uuid.UUID


class PhoneRoundActionResponse(BaseModel):
    candidate_id: uuid.UUID
    # advance: the new interview session; reject: None
    interview_session_id: Optional[uuid.UUID] = None
    # Whether the candidate's email (invitation or rejection) went out.
    email_sent: bool = False


class ScreeningCancelRequest(BaseModel):
    candidate_id: uuid.UUID


class ScreeningCancelResponse(BaseModel):
    candidate_id: uuid.UUID
    # Calls that were queued or scheduled and are now cancelled (1 when a marker was recorded).
    cancelled: int


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
    # Which round the card shows (0 before the first is scheduled) and how many there are.
    round_number: int = 0
    round_count: int = 0
    # True while the candidate is in the room; HR sees "Interview in progress" and no actions.
    is_live: bool = False
    finalist: bool = False
    # What HR may do right now, decided on the server (interview_round_service.available_actions).
    available_actions: List[str] = []
    screening_skipped: bool = False
    skip_reason: Optional[str] = None


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
    round_count: int = 1
    finalist_at: Optional[datetime] = None
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
    # Which part of the interview this was, and the topic it covered (when it was one).
    section: Optional[Literal["intro", "project", "topic"]] = None
    topic: Optional[str] = None


class TranscriptSegment(BaseModel):
    speaker: Literal["ai", "candidate"]
    text: str
    start_sec: float
    end_sec: float


class VideoProctoringFlag(BaseModel):
    model_config = ConfigDict(extra="ignore")

    timestamp: str = ""
    event: str = ""
    severity: str = ""
    confidence: float = 0.0


class VideoProctoringBreakdown(BaseModel):
    model_config = ConfigDict(extra="ignore")

    face: int = 0
    gaze: int = 0
    objects: int = 0


class VideoProctoringResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    duration: Optional[str] = None
    frame_count: Optional[int] = None
    flags: Optional[List[VideoProctoringFlag]] = None
    verdict: Optional[str] = None
    score: Optional[int] = None
    flag_count: Optional[int] = None
    breakdown: Optional[VideoProctoringBreakdown] = None


class VideoProctoringSummary(BaseModel):
    status: str
    error: Optional[str] = None
    result: Optional[VideoProctoringResult] = None


class ReportRoundSummary(BaseModel):
    """One interview round, for the round tabs on the report page."""

    session_id: uuid.UUID
    round_number: int
    status: str
    voided: bool = False
    void_reason: Optional[str] = None
    overall_score: Optional[float] = None
    completed_at: Optional[datetime] = None


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
    transcript_segments: Optional[List[TranscriptSegment]] = None
    # Presigned Linode/S3 URL for LiveKit egress recording (short-lived; not stored)
    recording_url: Optional[str] = None
    recording_key: Optional[str] = None
    video_proctoring: Optional[VideoProctoringSummary] = None
    # Extension-scan evidence for HR; None when no scan was recorded.
    integrity: Optional[IntegritySummary] = None
    # What the interview ran under. `enabled` is None for interviews that predate the
    # per-job check (no stamp), which the report treats as "not recorded".
    extension_check: Optional["ExtensionCheckStamp"] = None
    # Which round this report is for, and every round of the application (voided ones included)
    # so the page can offer the others. Voided: HR voided this round; the report stays for the record.
    round_number: int = 1
    voided_at: Optional[datetime] = None
    void_reason: Optional[str] = None
    rounds: List[ReportRoundSummary] = []


class ExtensionCheckStamp(BaseModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = None
    policy_version: Optional[int] = None
    #: When `enabled` is false: "org" (the Admin's master switch) or "job" (the job's own switch).
    disabled_by: Optional[Literal["org", "job"]] = None


InterviewReportResponse.model_rebuild()


# ---------------------------------------------------------------------------
# Auth / User schemas (RBAC)
# ---------------------------------------------------------------------------

RoleLiteral = Literal["superadmin", "admin", "hr"]
TenantMemberRoleLiteral = Literal["admin", "hr"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=128)
    password: str = Field(..., min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class PasswordTokenInfoResponse(BaseModel):
    email: EmailStr
    purpose: Literal["onboarding", "reset"]


class MessageResponse(BaseModel):
    message: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: RoleLiteral
    is_active: bool
    created_at: datetime
    updated_at: datetime
    tenant_name: Optional[str] = None
    home_tenant_id: Optional[uuid.UUID] = None
    active_tenant_id: Optional[uuid.UUID] = None
    active_tenant_name: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    user: UserResponse


class SignupRequest(BaseModel):
    organization_name: str = Field(..., min_length=1, max_length=_ORG_NAME_MAX_LEN)
    email: EmailStr
    password: str = Field(..., min_length=12, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=_PERSON_NAME_MAX_LEN)

    @field_validator("organization_name", "full_name")
    @classmethod
    def _strip_text(cls, v: str) -> str:
        return strip_required_text(v)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class SignupPendingResponse(BaseModel):
    """Returned after self-signup — account exists but access waits for approval."""

    message: str
    organization_name: str
    email: EmailStr
    verification_status: Literal["pending"] = "pending"


class AcceptInviteRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=128)
    password: str = Field(..., min_length=12, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=_PERSON_NAME_MAX_LEN)

    @field_validator("full_name")
    @classmethod
    def _strip_text(cls, v: str) -> str:
        return strip_required_text(v)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class InviteCreateRequest(BaseModel):
    email: EmailStr
    role: TenantMemberRoleLiteral = "hr"


class InviteResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    role: TenantMemberRoleLiteral
    token: str
    invite_url: str
    expires_at: datetime
    created_at: datetime
    email_sent: bool = False


class InviteListItem(BaseModel):
    id: uuid.UUID
    email: EmailStr
    role: TenantMemberRoleLiteral
    invite_url: str
    expires_at: datetime
    created_at: datetime
    status: Literal["pending", "expired"]


class InvitePublicResponse(BaseModel):
    email: EmailStr
    role: TenantMemberRoleLiteral
    organization_name: str
    expires_at: datetime


class SwitchTenantRequest(BaseModel):
    tenant_id: uuid.UUID


class TenantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    is_active: bool = True
    verification_status: Literal["pending", "approved", "rejected"] = "approved"
    company_registration_number: Optional[str] = None
    gst_document_filename: Optional[str] = None
    created_at: datetime
    # Set by actions that notify the organization admin (create, approve,
    # reject): False means the action succeeded but the email did not go out.
    email_sent: Optional[bool] = None


class TenantListItem(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    verification_status: Literal["pending", "approved", "rejected"] = "approved"
    company_registration_number: Optional[str] = None
    gst_document_filename: Optional[str] = None
    has_gst_document: bool = False
    admin_email: Optional[str] = None
    admin_full_name: Optional[str] = None
    created_at: datetime
    user_count: int = 0
    job_count: int = 0


class TenantCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=_ORG_NAME_MAX_LEN)
    admin_email: EmailStr
    admin_full_name: str = Field(..., min_length=1, max_length=_PERSON_NAME_MAX_LEN)
    # Optional: when omitted the server provisions an unusable password and the
    # admin sets their own through the emailed link, so no password is ever typed
    # by a Super Admin or sent in an email.
    admin_password: Optional[str] = Field(None, min_length=12, max_length=128)

    @field_validator("name", "admin_full_name")
    @classmethod
    def _strip_text(cls, v: str) -> str:
        return strip_required_text(v)

    @field_validator("admin_password")
    @classmethod
    def _password_strength(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return validate_password_strength(v)


class TenantUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=_ORG_NAME_MAX_LEN)
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _strip_text(cls, v: Optional[str]) -> Optional[str]:
        return strip_optional_text(v)


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=_PERSON_NAME_MAX_LEN)
    password: str = Field(..., min_length=12, max_length=128)
    role: TenantMemberRoleLiteral = "hr"

    @field_validator("full_name")
    @classmethod
    def _strip_text(cls, v: str) -> str:
        return strip_required_text(v)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=_PERSON_NAME_MAX_LEN)
    role: Optional[TenantMemberRoleLiteral] = None
    password: Optional[str] = Field(None, min_length=12, max_length=128)
    is_active: Optional[bool] = None

    @field_validator("full_name")
    @classmethod
    def _strip_text(cls, v: Optional[str]) -> Optional[str]:
        return strip_optional_text(v)

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return validate_password_strength(v)


class PaginatedResponse(BaseModel):
    items: list
    total: int
    limit: int
    offset: int


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., min_length=10)


class MfaSetupResponse(BaseModel):
    secret: str
    provisioning_uri: str


class MfaVerifyRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=8)


# ---------------------------------------------------------------------------
# Audit log schemas
# ---------------------------------------------------------------------------

class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    tenant_id: Optional[uuid.UUID] = None
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
    # Stored on every candidate-related row but not returned until now, so the UI could not
    # link a shortlist or interview event to the candidate it was about.
    candidate_id: Optional[uuid.UUID] = None


class AuditLogListResponse(BaseModel):
    items: List[AuditLogResponse]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Rejected stage
# ---------------------------------------------------------------------------

class RejectResponse(BaseModel):
    candidate_id: uuid.UUID
    rejected_from: Literal["resume", "phone", "interview"]
    #: False when the candidate was already rejected (a repeat does nothing).
    changed: bool = True


class ReconsiderResponse(BaseModel):
    candidate_id: uuid.UUID
    restored_to: Literal["resume", "phone", "interview"]


class RejectedCandidate(BaseModel):
    candidate_id: uuid.UUID
    candidate_name: Optional[str] = None
    candidate_email: Optional[str] = None
    rejected_from: Optional[Literal["resume", "phone", "interview"]] = None
    rejected_at: Optional[datetime] = None
    rejected_by_name: Optional[str] = None
    #: not_told | sending | emailed
    email_state: Literal["not_told", "sending", "emailed"]
    emailed_at: Optional[datetime] = None
    #: False when there is no address to write to (never uploaded one, or erased).
    can_email: bool = True
    #: Reconsider is possible until the candidate has been emailed.
    can_reconsider: bool = True
    has_report: bool = False


class RejectedListResponse(BaseModel):
    candidates: List[RejectedCandidate]


class RejectionEmailRequest(BaseModel):
    candidate_ids: List[uuid.UUID] = Field(min_length=1, max_length=10)


class RejectionEmailResult(BaseModel):
    candidate_id: uuid.UUID
    #: sent | failed | no_email | skipped (already told, sending, or no longer rejected)
    status: Literal["sent", "failed", "no_email", "skipped"]


class RejectionEmailResponse(BaseModel):
    results: List[RejectionEmailResult]
    sent: int
    failed: int
