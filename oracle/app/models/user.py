"""User, OrgMember, and TeamMember models — identity and membership."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin, _utcnow
from app.models.enums import OrgRole, TeamRole

if TYPE_CHECKING:
    from app.models.org import Org
    from app.models.team import Team
    from app.models.platform import PlatformIdentity


class User(Base, UUIDMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(),
    )

    # Relationships
    org_memberships: Mapped[List["OrgMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    team_memberships: Mapped[List["TeamMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    platform_identities: Mapped[List["PlatformIdentity"]] = relationship(back_populates="user")


class OrgMember(Base):
    """Composite PK (org_id, user_id). Links users to orgs with a role."""
    __tablename__ = "org_members"

    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
    )
    role: Mapped[OrgRole] = mapped_column(
        SAEnum(OrgRole, native_enum=False, length=16),
        nullable=False,
        default=OrgRole.MEMBER,
    )

    # Relationships
    org: Mapped["Org"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="org_memberships")


class TeamMember(Base):
    """Composite PK (team_id, user_id). Links users to teams with a role."""
    __tablename__ = "team_members"

    team_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
    )
    role: Mapped[TeamRole] = mapped_column(
        SAEnum(TeamRole, native_enum=False, length=16),
        nullable=False,
        default=TeamRole.MEMBER,
    )

    # Relationships
    team: Mapped["Team"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="team_memberships")
