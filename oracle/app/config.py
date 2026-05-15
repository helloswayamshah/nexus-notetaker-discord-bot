"""
Application configuration via Pydantic Settings.

Reads from environment variables with sensible defaults for local dev.
Supports both PostgreSQL (production) and SQLite (local dev) via DATABASE_URL.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration — all env vars read once at startup."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ──────────────────────────────────────────────────────
    app_name: str = "Nexus Oracle"
    debug: bool = False
    log_level: str = "info"
    oracle_port: int = 8000
    oracle_host: str = "0.0.0.0"

    # ── Database ─────────────────────────────────────────────────────────
    # PostgreSQL (default — local via docker-compose):
    #   postgresql+asyncpg://user:pass@host:5432/nexus
    # SQLite (lightweight fallback, no docker needed):
    #   sqlite+aiosqlite:///./dev.db
    database_url: str = "postgresql+asyncpg://nexus:nexus@localhost:5433/nexus"

    # ── Auth / JWT ───────────────────────────────────────────────────────
    jwt_secret: str = "CHANGE-ME-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24  # 24 hours

    # ── Encryption ───────────────────────────────────────────────────────
    # 32-byte key, base64 or 64-char hex. Same format as Node.js ENCRYPTION_KEY.
    encryption_key: str = ""

    # ── LLM defaults ────────────────────────────────────────────────────
    llm_default_base_url: str = "http://localhost:11434"
    llm_default_model: str = "llama3.1"

    # ── STT defaults ────────────────────────────────────────────────────
    stt_default_provider: str = "whispercpp"
    whisper_models_dir: str = "/opt/whisper-models"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    """Singleton settings instance, cached after first call."""
    return Settings()
