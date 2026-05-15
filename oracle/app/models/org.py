"""Org and Team models — the top-level tenancy hierarchy."""

import uuid
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.team import Team
    from app.models.user import OrgMember
    from app.models.platform import PlatformLink
    from app.models.event import Event


class Org(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "orgs"

    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(256), nullable=False)

    # Relationships
    teams: Mapped[List["Team"]] = relationship(back_populates="org", cascade="all, delete-orphan")
    members: Mapped[List["OrgMember"]] = relationship(back_populates="org", cascade="all, delete-orphan")
    platform_links: Mapped[List["PlatformLink"]] = relationship(back_populates="org", cascade="all, delete-orphan")
    events: Mapped[List["Event"]] = relationship(back_populates="org", cascade="all, delete-orphan")
