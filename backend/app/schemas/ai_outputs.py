"""Pydantic models for validating LLM structured outputs."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class ExperienceEntry(BaseModel):
    company: Optional[str] = None
    title: Optional[str] = None
    duration: Optional[str] = None
    description: Optional[str] = None


class EducationEntry(BaseModel):
    institution: Optional[str] = None
    degree: Optional[str] = None
    field: Optional[str] = None
    year: Optional[str] = None

    @field_validator("year", mode="before")
    @classmethod
    def _coerce_year(cls, value: object) -> Optional[str]:
        if value is None:
            return None
        return str(value)


class ParsedResumeData(BaseModel):
    """Structured resume parse output from the resume-parse model."""

    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    total_experience_years: float = 0
    experience: list[ExperienceEntry] = Field(default_factory=list)
    education: list[EducationEntry] = Field(default_factory=list)
    current_company: Optional[str] = None
    current_role: Optional[str] = None

    @field_validator("skills", mode="before")
    @classmethod
    def _coerce_skills(cls, value: object) -> list:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("skills must be a list of strings")
        return [str(s) for s in value if s is not None]

    @field_validator("experience", "education", mode="before")
    @classmethod
    def _coerce_list(cls, value: object) -> list:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("must be a list")
        return value

    @field_validator("total_experience_years", mode="before")
    @classmethod
    def _coerce_years(cls, value: object) -> float:
        if value is None:
            return 0.0
        return float(value)


class ShortlistAssessment(BaseModel):
    """Structured shortlist assessment from the shortlist model."""

    match_score: float = Field(ge=0, le=100)
    recommendation: Literal["shortlisted", "rejected", "review"]
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    reason: str = ""

    @field_validator("match_score", mode="before")
    @classmethod
    def _coerce_score(cls, value: object) -> float:
        if value is None:
            raise ValueError("match_score is required")
        score = float(value)
        return max(0.0, min(100.0, score))

    @field_validator("recommendation", mode="before")
    @classmethod
    def _normalize_recommendation(cls, value: object) -> str:
        if value is None:
            return "review"
        text = str(value).strip().lower()
        if text not in ("shortlisted", "rejected", "review"):
            return "review"
        return text

    @field_validator("strengths", "gaps", mode="before")
    @classmethod
    def _coerce_string_list(cls, value: object) -> list:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("must be a list of strings")
        return [str(s) for s in value if s is not None]

    @field_validator("reason", mode="before")
    @classmethod
    def _coerce_reason(cls, value: object) -> str:
        if value is None:
            return ""
        return str(value)


class CombinedShortlistOutput(BaseModel):
    """Single LLM response: candidate profile extraction plus JD-fit assessment."""

    profile: ParsedResumeData
    assessment: ShortlistAssessment
