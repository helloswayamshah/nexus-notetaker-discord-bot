"""Event repository — org-scoped with filtering and pagination."""

from datetime import datetime
from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.enums import EventType, Platform
from app.repositories.base import OrgScopedRepository


class EventRepository(OrgScopedRepository[Event]):
    def __init__(self, session: AsyncSession, org_id: UUID):
        super().__init__(session, Event, org_id)

    async def list_filtered(
        self,
        event_type: Optional[EventType] = None,
        platform: Optional[Platform] = None,
        team_id: Optional[UUID] = None,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> Sequence[Event]:
        stmt = self._scoped_select()
        if event_type:
            stmt = stmt.where(Event.event_type == event_type)
        if platform:
            stmt = stmt.where(Event.platform == platform)
        if team_id:
            stmt = stmt.where(Event.team_id == team_id)
        if since:
            stmt = stmt.where(Event.occurred_at >= since)
        if until:
            stmt = stmt.where(Event.occurred_at <= until)
        stmt = stmt.order_by(Event.occurred_at.desc()).offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def get_by_external_id(
        self, platform: Platform, external_id: str,
    ) -> Optional[Event]:
        stmt = (
            self._scoped_select()
            .where(Event.platform == platform, Event.external_id == external_id)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()
