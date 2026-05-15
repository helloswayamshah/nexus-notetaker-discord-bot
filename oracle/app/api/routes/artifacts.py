"""Artifact query routes."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, require_org_access

router = APIRouter()


@router.get("")
async def list_artifacts(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """STUB: Query derived intelligence across all events. Implemented in Phase 2."""
    return {"message": "STUB — Phase 2: list artifacts", "org_id": str(org_id), "artifacts": []}
