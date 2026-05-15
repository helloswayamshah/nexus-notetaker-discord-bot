"""Org repository — no org scoping since Org IS the top-level entity."""

from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.org import Org
from app.repositories.base import BaseRepository


class OrgRepository(BaseRepository[Org]):
    def __init__(self, session: AsyncSession):
        super().__init__(session, Org)

    async def get_by_slug(self, slug: str) -> Optional[Org]:
        stmt = select(Org).where(Org.slug == slug)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()
