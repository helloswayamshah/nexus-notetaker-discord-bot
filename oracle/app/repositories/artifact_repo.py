"""Artifact repository — org-scoped, filterable by type."""

from typing import Optional, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.enums import ArtifactType
from app.repositories.base import OrgScopedRepository


class ArtifactRepository(OrgScopedRepository[Artifact]):
    def __init__(self, session: AsyncSession, org_id: UUID):
        super().__init__(session, Artifact, org_id)

    async def list_by_event(self, event_id: UUID) -> Sequence[Artifact]:
        stmt = self._scoped_select().where(Artifact.event_id == event_id)
        result = await self._session.execute(stmt)
        return result.scalars().all()

    async def list_by_type(
        self,
        artifact_type: ArtifactType,
        offset: int = 0,
        limit: int = 50,
    ) -> Sequence[Artifact]:
        stmt = (
            self._scoped_select()
            .where(Artifact.artifact_type == artifact_type)
            .order_by(Artifact.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return result.scalars().all()
