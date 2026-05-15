"""Platform link (integration) routes."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, require_org_access

router = APIRouter()


@router.post("", status_code=201)
async def create_platform_link(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """STUB: Register a platform integration with encrypted credentials. Phase 2."""
    return {"message": "STUB — Phase 2: create platform link", "org_id": str(org_id)}


@router.get("")
async def list_platform_links(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """STUB: List platform integrations (credentials masked). Phase 2."""
    return {"message": "STUB — Phase 2: list platform links", "org_id": str(org_id), "links": []}
