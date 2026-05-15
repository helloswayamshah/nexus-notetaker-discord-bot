"""Platform link routes — real CRUD with credential encryption."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_session, require_org_access
from app.core.crypto import encrypt, is_key_configured
from app.models.platform import PlatformLink
from app.schemas.auth import PlatformLinkCreate, PlatformLinkRead

router = APIRouter()


@router.post("", status_code=201, response_model=PlatformLinkRead)
async def create_platform_link(
    org_id: UUID,
    body: PlatformLinkCreate,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """Register a platform integration with encrypted credentials."""
    # Encrypt credentials if provided
    encrypted_creds = None
    if body.credentials:
        if not is_key_configured():
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "ENCRYPTION_KEY not configured — cannot store credentials securely",
            )
        encrypted_creds = encrypt(body.credentials)

    link = PlatformLink(
        org_id=org_id,
        platform=body.platform,
        external_id=body.external_id,
        display_name=body.display_name,
        credentials_encrypted=encrypted_creds,
        config_json=body.config_json,
    )
    session.add(link)
    await session.flush()

    return PlatformLinkRead(
        id=link.id,
        org_id=link.org_id,
        platform=link.platform,
        external_id=link.external_id,
        display_name=link.display_name,
        has_credentials=link.credentials_encrypted is not None,
        config_json=link.config_json,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


@router.get("", response_model=list[PlatformLinkRead])
async def list_platform_links(
    org_id: UUID,
    session: AsyncSession = Depends(get_async_session),
    user=Depends(require_org_access),
):
    """List platform integrations (credentials masked)."""
    stmt = select(PlatformLink).where(PlatformLink.org_id == org_id)
    result = await session.execute(stmt)
    links = result.scalars().all()

    return [
        PlatformLinkRead(
            id=l.id,
            org_id=l.org_id,
            platform=l.platform,
            external_id=l.external_id,
            display_name=l.display_name,
            has_credentials=l.credentials_encrypted is not None,
            config_json=l.config_json,
            created_at=l.created_at,
            updated_at=l.updated_at,
        )
        for l in links
    ]
