"""Action item routes."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, require_org_access

router = APIRouter()


@router.get("")
async def list_action_items(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """STUB: Action items with status/assignee filters. Implemented in Phase 2."""
    return {"message": "STUB — Phase 2: list action items", "org_id": str(org_id), "items": []}


@router.patch("/{item_id}")
async def update_action_item(
    org_id: UUID,
    item_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """STUB: Update action item status. Implemented in Phase 2."""
    return {"message": "STUB — Phase 2: update action item", "item_id": str(item_id)}
