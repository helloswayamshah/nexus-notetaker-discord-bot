"""Event ingestion and query routes — real CRUD."""

import json
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.api.deps import get_async_session, require_org_access
from app.models.event import Event, EventParticipant
from app.models.artifact import Artifact
from app.models.enums import EventType, Platform
from app.repositories.event_repo import EventRepository
from app.schemas.event import (
    EventIngest, EventIngestResponse,
    EventRead, EventDetail, ParticipantRead,
)
from datetime import datetime
from app.core.queue import task_queue
from app.services.intelligence.pipeline import intelligence_pipeline


router = APIRouter()


@router.post("", status_code=202, response_model=EventIngestResponse)
async def ingest_event(
    org_id: UUID,
    body: EventIngest,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """
    Core ingest endpoint — adapters POST normalized events here.
    Persists Event + EventParticipant rows.
    Returns 202 Accepted (async processing enqueued for Phase 4).
    """
    repo = EventRepository(session, org_id)

    # Deduplicate by (org, platform, external_id)
    if body.external_id:
        existing = await repo.get_by_external_id(body.platform, body.external_id)
        if existing:
            return EventIngestResponse(event_id=existing.id, status="duplicate")

    event = Event(
        org_id=org_id,
        team_id=body.team_id,
        platform=body.platform,
        event_type=body.event_type,
        external_id=body.external_id,
        occurred_at=body.occurred_at,
        raw_content_json=json.dumps(body.raw_content) if body.raw_content else None,
    )
    event = await repo.create(event)

    # Persist participants
    for p in body.participants:
        participant = EventParticipant(
            event_id=event.id,
            platform_id=p.platform_id,
            role=p.role,
        )
        session.add(participant)

    await session.flush()

    # Phase 4: Enqueue Intelligence Pipeline
    async def run_pipeline():
        from app.database import async_session_factory
        async with async_session_factory() as background_session:
            await intelligence_pipeline.process_event(
                background_session, org_id, event.id, callback_url=body.callback_url
            )
            await background_session.commit()

    await task_queue.enqueue(run_pipeline)

    return EventIngestResponse(event_id=event.id, status="accepted")


@router.get("", response_model=list[EventRead])
async def list_events(
    org_id: UUID,
    event_type: Optional[EventType] = None,
    platform: Optional[Platform] = None,
    team_id: Optional[UUID] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """Paginated event list with filters."""
    repo = EventRepository(session, org_id)
    events = await repo.list_filtered(
        event_type=event_type,
        platform=platform,
        team_id=team_id,
        since=since,
        until=until,
        offset=offset,
        limit=limit,
    )
    return events


@router.get("/{event_id}", response_model=EventDetail)
async def get_event(
    org_id: UUID,
    event_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """Event detail with participants and artifact count."""
    repo = EventRepository(session, org_id)
    event = await repo.get_by_id(event_id)
    if not event:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    # Load participants
    stmt = select(EventParticipant).where(EventParticipant.event_id == event_id)
    result = await session.execute(stmt)
    participants = result.scalars().all()

    # Count artifacts
    stmt = select(func.count()).select_from(Artifact).where(
        Artifact.event_id == event_id, Artifact.org_id == org_id
    )
    result = await session.execute(stmt)
    artifact_count = result.scalar_one()

    return EventDetail(
        id=event.id,
        org_id=event.org_id,
        team_id=event.team_id,
        platform=event.platform,
        event_type=event.event_type,
        external_id=event.external_id,
        occurred_at=event.occurred_at,
        created_at=event.created_at,
        participants=[ParticipantRead.model_validate(p) for p in participants],
        artifact_count=artifact_count,
    )
