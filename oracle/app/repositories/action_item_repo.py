"""Action item repository — org-scoped with status/assignee filters."""

from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import ActionItem
from app.models.enums import ActionItemStatus
from app.repositories.base import OrgScopedRepository


class ActionItemRepository(OrgScopedRepository[ActionItem]):
    def __init__(self, session: AsyncSession, org_id: UUID):
        super().__init__(session, ActionItem, org_id)

    async def list_filtered(
        self,
        status: Optional[ActionItemStatus] = None,
        assignee_id: Optional[UUID] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> Sequence[ActionItem]:
        stmt = self._scoped_select()
        if status:
            stmt = stmt.where(ActionItem.status == status)
        if assignee_id:
            stmt = stmt.where(ActionItem.assignee_id == assignee_id)
        stmt = stmt.order_by(ActionItem.created_at.desc()).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def update_status(
        self, item_id: UUID, status: ActionItemStatus,
    ) -> Optional[ActionItem]:
        item = await self.get_by_id(item_id)
        if item is None:
            return None
        item.status = status
        await self._session.flush()
        return item
