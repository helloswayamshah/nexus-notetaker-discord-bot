"""
Enum types shared across ORM models, Pydantic schemas, and API routes.
"""

import enum


class Platform(str, enum.Enum):
    DISCORD = "discord"
    SLACK = "slack"
    ZOOM = "zoom"
    TEAMS = "teams"


class EventType(str, enum.Enum):
    VOICE_CALL = "voice_call"
    CHANNEL_DIGEST = "channel_digest"
    FILE_UPLOAD = "file_upload"
    WEBHOOK = "webhook"


class ArtifactType(str, enum.Enum):
    TRANSCRIPT = "transcript"
    SUMMARY = "summary"
    ACTION_ITEMS = "action_items"
    INSIGHT = "insight"
    ANOMALY_REPORT = "anomaly_report"
    WEEKLY_DIGEST = "weekly_digest"


class ActionItemStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELLED = "cancelled"


class OrgRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class TeamRole(str, enum.Enum):
    LEAD = "lead"
    MEMBER = "member"
