"""
SQLAlchemy declarative base and shared mixins.

All ORM models inherit from Base and use the provided mixins
for consistent UUID primary keys and timestamps.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class Base(DeclarativeBase):
    """Declarative base for all Nexus ORM models."""
    pass


class UUIDMixin:
    """Adds a UUID v4 primary key column."""
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=_new_uuid,
    )


class TimestampMixin:
    """Adds created_at and updated_at columns with auto-population."""
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utcnow,
        onupdate=_utcnow,
        server_default=func.now(),
    )
