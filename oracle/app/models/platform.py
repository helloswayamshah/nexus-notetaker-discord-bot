"""PlatformLink and PlatformIdentity models — platform integration and identity stitching."""

import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Enum as SAEnum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDMixin, TimestampMixin
from app.models.enums import Platform

if TYPE_CHECKING:
    from app.models.org import Org
    from app.models.user import User


class PlatformLink(Base, UUIDMixin, TimestampMixin):
    """
    A registered platform integration for an org.
    Stores encrypted credentials (bot tokens, API keys) and per-platform config.
    """
    __tablename__ = "platform_links"
    __table_args__ = (
        UniqueConstraint("org_id", "platform", "external_id", name="uq_platform_link_org_plat_ext"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    platform: Mapped[Platform] = mapped_column(
        SAEnum(Platform, native_enum=False, length=16), nullable=False,
    )
    external_id: Mapped[str] = mapped_column(String(256), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(256))
    credentials_encrypted: Mapped[Optional[str]] = mapped_column(Text)
    config_json: Mapped[Optional[str]] = mapped_column(Text)

    # Relationships
    org: Mapped["Org"] = relationship(back_populates="platform_links")


class PlatformIdentity(Base):
    """
    Maps a platform-native user ID to a Nexus User.
    Composite PK (platform, external_id).
    user_id is nullable — unresolved identities park here until the user
    connects their account.
    """
    __tablename__ = "platform_identities"

    platform: Mapped[Platform] = mapped_column(
        SAEnum(Platform, native_enum=False, length=16), primary_key=True,
    )
    external_id: Mapped[str] = mapped_column(String(256), primary_key=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True,
    )

    # Relationships
    user: Mapped[Optional["User"]] = relationship(back_populates="platform_identities")
