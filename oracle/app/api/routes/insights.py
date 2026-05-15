"""Insights routes — aggregated productivity intelligence."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, require_org_access

router = APIRouter()


@router.get("/summary")
async def insights_summary(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """
    STUB: Aggregated productivity snapshot.
    Phase 4 populates this with real intelligence from the pipeline.
    """
    return {
        "org_id": str(org_id),
        "period": "last_7_days",
        "total_events": 0,
        "total_action_items": 0,
        "open_action_items": 0,
        "active_members": 0,
        "top_topics": [],
        "message": "STUB — Phase 4: real insights from intelligence pipeline",
    }
