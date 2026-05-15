"""
FastAPI application factory with error handling middleware.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.api.routes import orgs, events, artifacts, action_items, platform_links, auth, insights


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup / shutdown lifecycle hook."""
    from app.api.deps import init_engine, dispose_engine

    settings = get_settings()
    await init_engine(settings.database_url)
    yield
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description="Central AI Oracle — the connective tissue across all your platforms.",
        version="0.2.0",
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Error handling ───────────────────────────────────────────────────
    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError):
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": str(exc)}},
        )

    @app.exception_handler(Exception)
    async def generic_error_handler(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": "An unexpected error occurred"}},
        )

    # ── Routes ───────────────────────────────────────────────────────────
    app.include_router(auth.router, prefix="/auth", tags=["Auth"])
    app.include_router(orgs.router, prefix="/orgs", tags=["Orgs"])
    app.include_router(events.router, prefix="/orgs/{org_id}/events", tags=["Events"])
    app.include_router(artifacts.router, prefix="/orgs/{org_id}/artifacts", tags=["Artifacts"])
    app.include_router(action_items.router, prefix="/orgs/{org_id}/action-items", tags=["Action Items"])
    app.include_router(platform_links.router, prefix="/orgs/{org_id}/platform-links", tags=["Platform Links"])
    app.include_router(insights.router, prefix="/orgs/{org_id}/insights", tags=["Insights"])

    @app.get("/health", tags=["System"])
    async def health():
        return {"status": "ok", "service": "nexus-oracle", "version": "0.2.0"}

    return app


app = create_app()
