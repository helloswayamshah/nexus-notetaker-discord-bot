"""Org management routes."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, get_current_user

router = APIRouter()


@router.post("", status_code=201)
async def create_org(
    session: AsyncSession = Depends(get_async_session),
    user=Depends(get_current_user),
):
    """STUB: Create a new org, assign creator as OWNER. Implemented in Phase 2."""
    return {"message": "STUB — Phase 2: create org"}


@router.get("/{org_id}")
async def get_org(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(get_current_user),
):
    """STUB: Get org details. Implemented in Phase 2."""
    return {"message": "STUB — Phase 2: get org", "org_id": str(org_id)}
