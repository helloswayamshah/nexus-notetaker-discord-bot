"""Pydantic schemas for Event endpoints."""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EventType, Platform


# ── Ingest (from adapters) ───────────────────────────────────────────────

class ParticipantIngest(BaseModel):
    platform_id: str = Field(..., max_length=256)
    role: Optional[str] = Field(None, max_length=64)


class EventIngest(BaseModel):
    """Payload adapters POST to /orgs/{org_id}/events."""
    platform: Platform
    event_type: EventType
    external_id: Optional[str] = Field(None, max_length=256)
    occurred_at: datetime
    participants: List[ParticipantIngest] = Field(default_factory=list)
    raw_content: Optional[Dict[str, Any]] = None
    callback_url: Optional[str] = None
    team_id: Optional[UUID] = None


class EventIngestResponse(BaseModel):
    event_id: UUID
    status: str = "accepted"
    job_id: Optional[str] = None


# ── Read ─────────────────────────────────────────────────────────────────

class ParticipantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    platform_id: str
    user_id: Optional[UUID] = None
    role: Optional[str] = None


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    org_id: UUID
    team_id: Optional[UUID] = None
    platform: Platform
    event_type: EventType
    external_id: Optional[str] = None
    occurred_at: datetime
    created_at: datetime


class EventDetail(EventRead):
    participants: List[ParticipantRead] = []
    artifact_count: int = 0


# ── Query params ─────────────────────────────────────────────────────────

class EventFilter(BaseModel):
    event_type: Optional[EventType] = None
    platform: Optional[Platform] = None
    team_id: Optional[UUID] = None
    since: Optional[datetime] = None
    until: Optional[datetime] = None
    offset: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=100)
