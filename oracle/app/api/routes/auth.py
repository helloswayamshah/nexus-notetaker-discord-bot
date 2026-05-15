"""Auth routes — login, token refresh. STUB for Phase 2."""

from fastapi import APIRouter

router = APIRouter()


@router.post("/token")
async def login():
    """STUB: Phase 2 — authenticate user, return JWT."""
    return {"access_token": "dev-token", "token_type": "bearer"}
