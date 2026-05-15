"""Artifact and ActionItem models — derived intelligence from events."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Enum as SAEnum, ForeignKey, Index, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, _utcnow
from app.models.enums import ArtifactType, ActionItemStatus

if TYPE_CHECKING:
    from app.models.org import Org
    from app.models.event import Event
    from app.models.user import User


class Artifact(Base, UUIDMixin):
    """
    Derived intelligence linked to an event.
    Types: TRANSCRIPT, SUMMARY, ACTION_ITEMS, INSIGHT, ANOMALY_REPORT, WEEKLY_DIGEST.
    """
    __tablename__ = "artifacts"

    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"),
    )
    artifact_type: Mapped[ArtifactType] = mapped_column(
        SAEnum(ArtifactType, native_enum=False, length=32), nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    # Relationships
    event: Mapped[Optional["Event"]] = relationship(back_populates="artifacts")
    action_items: Mapped[List["ActionItem"]] = relationship(
        back_populates="artifact", cascade="all, delete-orphan",
    )


class ActionItem(Base, UUIDMixin):
    """Actionable tasks extracted from artifacts (summaries, transcripts)."""
    __tablename__ = "action_items"
    __table_args__ = (
        Index("ix_action_org_status", "org_id", "status"),
        Index("ix_action_assignee_status", "assignee_id", "status"),
    )

    artifact_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artifacts.id", ondelete="CASCADE"), nullable=False,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False,
    )
    assignee_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    assignee_raw: Mapped[Optional[str]] = mapped_column(String(256))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ActionItemStatus] = mapped_column(
        SAEnum(ActionItemStatus, native_enum=False, length=16),
        nullable=False,
        default=ActionItemStatus.OPEN,
    )
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow,
    )

    # Relationships
    artifact: Mapped["Artifact"] = relationship(back_populates="action_items")
