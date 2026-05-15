"""Event and EventParticipant models — the normalized event stream."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Enum as SAEnum, ForeignKey, Index, String, Text, UniqueConstraint, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, _utcnow
from app.models.enums import Platform, EventType

if TYPE_CHECKING:
    from app.models.org import Org
    from app.models.team import Team
    from app.models.artifact import Artifact


class Event(Base, UUIDMixin):
    """
    Every ingested signal — voice call, Slack digest, file upload, webhook —
    becomes an Event row. This is the core of the knowledge graph.
    """
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("org_id", "platform", "external_id", name="uq_event_org_plat_ext"),
        Index("ix_event_org_occurred", "org_id", "occurred_at"),
        Index("ix_event_org_type", "org_id", "event_type"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False,
    )
    team_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"),
    )
    platform: Mapped[Platform] = mapped_column(
        SAEnum(Platform, native_enum=False, length=16), nullable=False,
    )
    event_type: Mapped[EventType] = mapped_column(
        SAEnum(EventType, native_enum=False, length=32), nullable=False,
    )
    external_id: Mapped[Optional[str]] = mapped_column(String(256))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    raw_content_json: Mapped[Optional[str]] = mapped_column(Text)

    # Relationships
    org: Mapped["Org"] = relationship(back_populates="events")
    participants: Mapped[List["EventParticipant"]] = relationship(
        back_populates="event", cascade="all, delete-orphan",
    )
    artifacts: Mapped[List["Artifact"]] = relationship(
        back_populates="event", cascade="all, delete-orphan",
    )


class EventParticipant(Base):
    """Links events to participants (resolved or unresolved)."""
    __tablename__ = "event_participants"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True,
    )
    platform_id: Mapped[str] = mapped_column(String(256), primary_key=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    role: Mapped[Optional[str]] = mapped_column(String(64))

    # Relationships
    event: Mapped["Event"] = relationship(back_populates="participants")
