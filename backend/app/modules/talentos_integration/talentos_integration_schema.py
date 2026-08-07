from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import List, Literal, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TalentosJobCreate(BaseModel):
    title: str
    description: str
    required_skills: Optional[List[str]] = None
    location: Optional[str] = None
    department: Optional[str] = None
    employment_type: Optional[str] = None
    external_job_id: Optional[str] = None


class TalentosJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str
    required_skills: Optional[List[str]] = None
    status: str
    created_at: datetime


class TalentosCandidateCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    external_candidate_id: Optional[str] = None


class TalentosCandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    name: str
    email: str
    phone: Optional[str] = None
    external_candidate_id: Optional[str] = None
    pipeline_status: str
    created_at: datetime


class TalentosWithScreeningPayload(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    external_candidate_id: Optional[str] = None
    external_job_id: Optional[str] = None
    force: bool = False


class TalentosWithScreeningResponse(BaseModel):
    candidate: TalentosCandidateResponse
    screening_call_id: Optional[str] = None
    screening_initiated: bool
    screening_queued: bool
    screening_skipped: Optional[list[dict]] = None


class TalentosWithInterviewPayload(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    external_candidate_id: Optional[str] = None
    external_job_id: Optional[str] = None
    force: bool = False
    interview_type: Optional[str] = "AI_INTERVIEW"


class TalentosWithInterviewResponse(BaseModel):
    candidate: TalentosCandidateResponse
    interview: TalentosInterviewResponse


class TalentosScreeningTriggerResponse(BaseModel):
    screening_call_id: uuid.UUID
    status: str = "triggered"


class TalentosScreeningResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    call_status: str
    result: Optional[str] = None
    summary: Optional[str] = None
    availability: Optional[str] = None
    employment_status: Optional[str] = None
    relevant_experience: Optional[str] = None
    current_ctc: Optional[str] = None
    expected_ctc: Optional[str] = None
    notice_period: Optional[str] = None
    location_preference: Optional[str] = None
    communication_quality: Optional[str] = None
    willingness_to_proceed: Optional[bool] = None
    transcript: Optional[str] = None
    call_outcome: Optional[str] = None
    ended_reason: Optional[str] = None
    retry_count: int = 0
    terminal_failure: bool = False
    created_at: datetime


class TalentosScreeningStatusResponse(BaseModel):
    """Server-computed screening disposition for a candidate (pending/completed/flagged).

    Unlike TalentosScreeningResultResponse (404 when no call exists), this
    endpoint always classifies the candidate — even before any ScreeningCall row
    exists (e.g. flagged for a missing/invalid phone number).
    """

    disposition: Literal["pending", "completed", "flagged"]
    flag_reason: Optional[str] = None
    has_call: bool = False
    latest_call: Optional[TalentosScreeningResultResponse] = None
    updated_at: Optional[datetime] = None


class TalentosInterviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    hr_decision: str
    interview_url: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    scheduled_interview_at: Optional[datetime] = None


class TalentosInterviewSchedulePayload(BaseModel):
    """Set (or clear) the scheduled slot on an existing interview session."""

    scheduled_date: Optional[str] = Field(default=None, description="YYYY-MM-DD")
    scheduled_time: Optional[str] = Field(default=None, description="HH:MM (24h)")
    timezone: Optional[str] = Field(default=None, description="IANA timezone")

    @field_validator("timezone")
    @classmethod
    def _validate_timezone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except Exception as exc:
            raise ValueError(f"Invalid timezone: {value}") from exc
        return value


class TalentosInterviewDetailResponse(TalentosInterviewResponse):
    transcript: Optional[str] = None
    transcript_segments: Optional[List[dict]] = None
    recording_key: Optional[str] = None
    summary: Optional[str] = None
    transcript_summary: Optional[str] = None
    overall_score: Optional[float] = None
    technical_fit_score: Optional[float] = None
    communication_score: Optional[float] = None
    problem_solving_score: Optional[float] = None
    experience_score: Optional[float] = None
    role_alignment_score: Optional[float] = None
    strengths: Optional[List[str]] = None
    weaknesses: Optional[List[str]] = None
    jd_fit: Optional[str] = None
    final_recommendation: Optional[str] = None


class TalentosInterviewTriggerResponse(BaseModel):
    interview_session_id: uuid.UUID
    status: str = "created"


class TalentosJobQuestionsResponse(BaseModel):
    job_id: Optional[uuid.UUID] = None
    screening_questions: List[dict] = []
    interview_questions: List[dict] = []


class TalentosJobQuestionsUpdate(BaseModel):
    screening_questions: Optional[List[dict]] = None
    interview_questions: Optional[List[dict]] = None


class TalentosCallWindowResponse(BaseModel):
    job_id: Optional[uuid.UUID] = None
    screening_call_from: Optional[time] = None
    screening_call_to: Optional[time] = None
    screening_timezone: str = "Asia/Kolkata"


class TalentosCallWindowUpdate(BaseModel):
    screening_call_from: Optional[time] = None
    screening_call_to: Optional[time] = None
    screening_timezone: Optional[str] = None

    @field_validator("screening_timezone")
    @classmethod
    def _validate_timezone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except Exception as exc:
            raise ValueError(f"Invalid timezone: {value}") from exc
        return value
