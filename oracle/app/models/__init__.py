"""
ORM model registry — import all models here so Alembic and the app
can discover them through Base.metadata.
"""

from app.models.base import Base
from app.models.enums import (
    Platform, EventType, ArtifactType, ActionItemStatus, OrgRole, TeamRole,
)
from app.models.org import Org
from app.models.team import Team
from app.models.user import User, OrgMember, TeamMember
from app.models.platform import PlatformLink, PlatformIdentity
from app.models.event import Event, EventParticipant
from app.models.artifact import Artifact, ActionItem

__all__ = [
    "Base",
    "Platform", "EventType", "ArtifactType", "ActionItemStatus", "OrgRole", "TeamRole",
    "Org", "Team", "User", "OrgMember", "TeamMember",
    "PlatformLink", "PlatformIdentity",
    "Event", "EventParticipant",
    "Artifact", "ActionItem",
]
