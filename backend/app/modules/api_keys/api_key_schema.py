from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class CreateApiKeyRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Human-readable name for this app key")
    description: Optional[str] = Field(None, description="Optional description")


class IssueApiKeyRequest(BaseModel):
    tenant_id: UUID = Field(..., description="Organization/tenant this key is scoped to")
    name: str = Field(..., min_length=1, max_length=255, description="Human-readable name for this app key")
    description: Optional[str] = Field(None, description="Optional description")


class UpdateApiKeyRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None


class ApiKeyResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    key_prefix: str
    is_active: bool
    created_by_user_id: Optional[UUID] = None
    tenant_id: Optional[UUID] = None
    last_used_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ApiKeyCreatedResponse(ApiKeyResponse):
    full_key: str


class ApiKeyListResponse(BaseModel):
    data: list[ApiKeyResponse]
    total: int
