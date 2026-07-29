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


class TalentosCandidateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    name: str
    email: str
    phone: Optional[str] = None
    pipeline_status: str
    created_at: datetime


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


class TalentosInterviewTriggerResponse(BaseModel):
    interview_session_id: uuid.UUID
    status: str = "created"
