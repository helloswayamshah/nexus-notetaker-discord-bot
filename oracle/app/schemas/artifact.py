"""Pydantic schemas for Artifact and ActionItem endpoints."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ActionItemStatus, ArtifactType


# ── Artifact ─────────────────────────────────────────────────────────────

class ArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    org_id: UUID
    event_id: Optional[UUID] = None
    artifact_type: ArtifactType
    content: str
    metadata_json: Optional[str] = None
    created_at: datetime


class ArtifactFilter(BaseModel):
    artifact_type: Optional[ArtifactType] = None
    event_id: Optional[UUID] = None
    offset: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=100)


# ── ActionItem ───────────────────────────────────────────────────────────

class ActionItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    artifact_id: UUID
    org_id: UUID
    assignee_id: Optional[UUID] = None
    assignee_raw: Optional[str] = None
    text: str
    status: ActionItemStatus
    due_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ActionItemUpdate(BaseModel):
    status: Optional[ActionItemStatus] = None
    assignee_id: Optional[UUID] = None


class ActionItemFilter(BaseModel):
    status: Optional[ActionItemStatus] = None
    assignee_id: Optional[UUID] = None
    offset: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=100)
