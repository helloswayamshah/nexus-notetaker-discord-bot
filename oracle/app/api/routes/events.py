"""Event ingestion and query routes."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, require_org_access

router = APIRouter()


@router.post("", status_code=202)
async def ingest_event(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """
    STUB: Core ingest endpoint — adapters POST normalized events here.
    Persists Event + EventParticipant, enqueues intelligence job.
    Returns 202 Accepted. Implemented in Phase 2.
    """
    return {"message": "STUB — Phase 2: ingest event", "org_id": str(org_id)}


@router.get("")
async def list_events(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """STUB: Paginated event list with filters. Implemented in Phase 2."""
    return {"message": "STUB — Phase 2: list events", "org_id": str(org_id), "events": []}


@router.get("/{event_id}")
async def get_event(
    org_id: UUID,
    event_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """STUB: Event detail with artifacts. Implemented in Phase 2."""
    return {"message": "STUB — Phase 2: get event", "event_id": str(event_id)}
