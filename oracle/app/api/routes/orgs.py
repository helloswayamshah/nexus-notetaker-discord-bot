"""Org management routes — real CRUD."""

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, get_current_user
from app.models.org import Org
from app.models.user import User, OrgMember
from app.models.enums import OrgRole
from app.repositories.org_repo import OrgRepository
from app.schemas.org import OrgCreate, OrgRead, OrgUpdate

router = APIRouter()


@router.post("", status_code=201, response_model=OrgRead)
async def create_org(
    body: OrgCreate,
    session: AsyncSession = Depends(get_async_session),
    current_user=Depends(get_current_user),
):
    """Create a new org and assign the creator as OWNER."""
    repo = OrgRepository(session)

    existing = await repo.get_by_slug(body.slug)
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Org slug '{body.slug}' already taken")

    org = Org(slug=body.slug, display_name=body.display_name)
    org = await repo.create(org)

    # Auto-assign creator as owner
    member = OrgMember(
        org_id=org.id,
        user_id=UUID(current_user["user_id"]),
        role=OrgRole.OWNER,
    )
    session.add(member)
    await session.flush()

    return org


@router.get("/{org_id}", response_model=OrgRead)
async def get_org(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(get_current_user),
):
    """Get org details."""
    repo = OrgRepository(session)
    org = await repo.get_by_id(org_id)
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Org not found")
    return org
