"""Artifact query routes — real CRUD."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, require_org_access
from app.models.enums import ArtifactType
from app.repositories.artifact_repo import ArtifactRepository
from app.schemas.artifact import ArtifactRead, ArtifactFilter

router = APIRouter()


@router.get("", response_model=list[ArtifactRead])
async def list_artifacts(
    org_id: UUID,
    artifact_type: Optional[ArtifactType] = None,
    event_id: Optional[UUID] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """Query derived intelligence across all events."""
    repo = ArtifactRepository(session, org_id)
    if event_id:
        artifacts = await repo.list_by_event(event_id)
    elif artifact_type:
        artifacts = await repo.list_by_type(artifact_type, offset=offset, limit=limit)
    else:
        artifacts = await repo.list_all(offset=offset, limit=limit)
    return artifacts


@router.get("/{artifact_id}", response_model=ArtifactRead)
async def get_artifact(
    org_id: UUID,
    artifact_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """Get a single artifact."""
    repo = ArtifactRepository(session, org_id)
    artifact = await repo.get_by_id(artifact_id)
    if not artifact:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artifact not found")
    return artifact
