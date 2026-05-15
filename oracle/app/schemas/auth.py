"""Pydantic schemas for Auth and PlatformLink endpoints."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Platform


# ── Auth ─────────────────────────────────────────────────────────────────

class TokenRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── PlatformLink ─────────────────────────────────────────────────────────

class PlatformLinkCreate(BaseModel):
    platform: Platform
    external_id: str = Field(..., max_length=256)
    display_name: Optional[str] = Field(None, max_length=256)
    credentials: Optional[str] = None  # plaintext — encrypted server-side
    config_json: Optional[str] = None


class PlatformLinkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    org_id: UUID
    platform: Platform
    external_id: str
    display_name: Optional[str] = None
    has_credentials: bool = False  # never expose actual creds
    config_json: Optional[str] = None
    created_at: datetime
    updated_at: datetime
