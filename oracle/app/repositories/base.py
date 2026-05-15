"""
Base repository with automatic org_id scoping.

Every repository that handles org-owned data inherits from OrgScopedRepository.
This enforces the invariant: no cross-org data access is architecturally possible.
"""

from typing import Generic, List, Optional, Sequence, Type, TypeVar
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import Base

T = TypeVar("T", bound=Base)


class BaseRepository(Generic[T]):
    """
    Thin repository base — provides typed CRUD without org scoping.
    Used for top-level entities like Org and User.
    """

    def __init__(self, session: AsyncSession, model: Type[T]):
        self._session = session
        self._model = model

    async def get_by_id(self, entity_id: UUID) -> Optional[T]:
        return await self._session.get(self._model, entity_id)

    async def create(self, entity: T) -> T:
        self._session.add(entity)
        await self._session.flush()
        return entity

    async def delete(self, entity: T) -> None:
        await self._session.delete(entity)
        await self._session.flush()


class OrgScopedRepository(Generic[T]):
    """
    Repository base that automatically scopes every query to an org_id.
    This is the primary enforcement mechanism for org isolation —
    it is a repository-level invariant, not a caller responsibility.

    Every method that queries data injects WHERE org_id = :org_id.
    """

    def __init__(self, session: AsyncSession, model: Type[T], org_id: UUID):
        self._session = session
        self._model = model
        self._org_id = org_id

    def _scoped_select(self):
        """Returns a SELECT statement pre-filtered by org_id."""
        return select(self._model).where(self._model.org_id == self._org_id)

    async def get_by_id(self, entity_id: UUID) -> Optional[T]:
        """Get by ID, scoped to this org. Returns None if not found or wrong org."""
        stmt = self._scoped_select().where(self._model.id == entity_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(
        self,
        offset: int = 0,
        limit: int = 50,
    ) -> Sequence[T]:
        """List all entities for this org with pagination."""
        stmt = self._scoped_select().offset(offset).limit(limit)
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def count(self) -> int:
        """Count all entities for this org."""
        stmt = (
            select(func.count())
            .select_from(self._model)
            .where(self._model.org_id == self._org_id)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one()

    async def create(self, entity: T) -> T:
        """Create an entity, forcing org_id to this repository's scope."""
        entity.org_id = self._org_id
        self._session.add(entity)
        await self._session.flush()
        return entity

    async def delete(self, entity: T) -> None:
        """Delete an entity (must belong to this org)."""
        if entity.org_id != self._org_id:
            raise ValueError("Cannot delete entity from a different org")
        await self._session.delete(entity)
        await self._session.flush()
