"""Action item routes — real CRUD with status/assignee filters."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, require_org_access
from app.models.enums import ActionItemStatus
from app.repositories.action_item_repo import ActionItemRepository
from app.schemas.artifact import ActionItemRead, ActionItemUpdate

router = APIRouter()


@router.get("", response_model=list[ActionItemRead])
async def list_action_items(
    org_id: UUID,
    item_status: Optional[ActionItemStatus] = Query(None, alias="status"),
    assignee_id: Optional[UUID] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """Action items with status/assignee filters."""
    repo = ActionItemRepository(session, org_id)
    items = await repo.list_filtered(
        status=item_status,
        assignee_id=assignee_id,
        offset=offset,
        limit=limit,
    )
    return items


@router.patch("/{item_id}", response_model=ActionItemRead)
async def update_action_item(
    org_id: UUID,
    item_id: UUID,
    body: ActionItemUpdate,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """Update action item status or assignee."""
    repo = ActionItemRepository(session, org_id)
    item = await repo.get_by_id(item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Action item not found")

    if body.status is not None:
        item.status = body.status
    if body.assignee_id is not None:
        item.assignee_id = body.assignee_id

    await session.flush()
    return item
