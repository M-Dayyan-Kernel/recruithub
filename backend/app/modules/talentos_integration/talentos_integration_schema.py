from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict


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
    created_at: datetime


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


class TalentosInterviewDetailResponse(TalentosInterviewResponse):
    transcript: Optional[str] = None
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
