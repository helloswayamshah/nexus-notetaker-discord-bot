"""Team model — belongs to an Org, scopes events and members."""

import uuid
from typing import TYPE_CHECKING, List

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin

if TYPE_CHECKING:
    from app.models.org import Org
    from app.models.user import TeamMember


class Team(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("org_id", "slug", name="uq_team_org_slug"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(256), nullable=False)

    # Relationships
    org: Mapped["Org"] = relationship(back_populates="teams")
    members: Mapped[List["TeamMember"]] = relationship(back_populates="team", cascade="all, delete-orphan")
