"""Pydantic schemas for Org endpoints."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrgCreate(BaseModel):
    slug: str = Field(..., min_length=2, max_length=64, pattern=r"^[a-z0-9\-]+$")
    display_name: str = Field(..., min_length=1, max_length=256)


class OrgRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    display_name: str
    created_at: datetime
    updated_at: datetime


class OrgUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=256)
