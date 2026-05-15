"""
FastAPI dependency injection providers.

Manages the async SQLAlchemy engine and session factory.
All database access flows through get_async_session(), which yields
a scoped AsyncSession per request.
"""

from typing import AsyncGenerator
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, get_settings

# Module-level state — initialized during app lifespan
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


async def init_engine(database_url: str) -> None:
    """Called once during app startup (lifespan)."""
    global _engine, _session_factory

    connect_args = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    _engine = create_async_engine(
        database_url,
        echo=False,
        connect_args=connect_args,
    )
    _session_factory = async_sessionmaker(
        _engine,
        expire_on_commit=False,
        class_=AsyncSession,
    )


async def dispose_engine() -> None:
    """Called once during app shutdown (lifespan)."""
    global _engine, _session_factory
    if _engine:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Yields one AsyncSession per request, auto-closed on exit."""
    if _session_factory is None:
        raise RuntimeError("Database engine not initialized — call init_engine() first")
    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── Auth dependency ───────────────────────────────────────────────────

_DEV_USER_ID = "00000000-0000-0000-0000-000000000000"
_dev_user_seeded = False


async def _ensure_dev_user(session: AsyncSession) -> None:
    """Auto-seed a dev user row so FK constraints are satisfied."""
    global _dev_user_seeded
    if _dev_user_seeded:
        return

    from app.models.user import User

    existing = await session.get(User, UUID(_DEV_USER_ID))
    if not existing:
        dev_user = User(
            id=UUID(_DEV_USER_ID),
            email="dev@nexus.local",
            name="Dev User",
        )
        session.add(dev_user)
        await session.flush()

    _dev_user_seeded = True


async def get_current_user(
    session: AsyncSession = Depends(get_async_session),
):
    """
    DEV STUB: Returns a placeholder user dict and ensures the dev user exists in DB.
    Full auth replaces this with real JWT validation.
    """
    await _ensure_dev_user(session)
    return {
        "user_id": _DEV_USER_ID,
        "email": "dev@nexus.local",
        "name": "Dev User",
    }


async def require_org_access(
    org_id: UUID,
    user=Depends(get_current_user),
):
    """
    STUB: Verifies the current user has access to the given org.
    Full auth replaces with real OrgMember lookup + role check.
    """
    # For now, allow all access in dev mode
    return user
