# Nexus Oracle Testing & Validation Guide

This guide provides step-by-step instructions for testing the new server-based architecture across all five implementation phases.

## 🛠️ Phase 1 & 2: Oracle Core & API
**Goal:** Verify the Python FastAPI backend is healthy and correctly managing the PostgreSQL state.

1.  **Database Migration:**
    ```powershell
    cd oracle
    # Ensure postgres is running
    poetry run alembic upgrade head
    ```
2.  **Start Oracle:**
    ```powershell
    poetry run uvicorn app.main:app --reload
    ```
3.  **Smoke Test:**
    *   Open `http://localhost:8000/docs` (Swagger).
    *   Check `GET /health` returns `{"status": "ok"}`.
4.  **Resolve Test:**
    *   Create a test Org via `POST /orgs`.
    *   Create a Platform Link via `POST /orgs/{id}/platform-links` (use platform: `discord`, external_id: `test-guild`).
    *   Test `GET /orgs/platform-links/resolve/discord/test-guild`. It should return the Org ID and the linked config.

## 🔌 Phase 3: Adapter Rewiring
**Goal:** Verify Node.js adapters can dynamically resolve their identity via the Oracle.

1.  **Configure Environment:**
    *   Set `USE_ORACLE=true` and `ORACLE_BASE_URL=http://localhost:8000` in `.env`.
2.  **Run Discord Adapter:**
    ```powershell
    # From project root
    node adapters/discord/src/index.js
    ```
3.  **Verification:**
    *   Watch the logs. On startup/command execution, you should see:
        *   `[core:oracle] fetching config for discord:XXXXXXXX`
    *   If the Guild is linked in Oracle, it will use those settings.
    *   If not linked, it should log a warning and fallback to local SQLite seamlessly.

## 🧠 Phase 4: Intelligence Pipeline
**Goal:** Verify the "Brain" correctly processes events into summaries and action items.

1.  **Mock Ingestion:**
    Use Curl or the Swagger UI to `POST /orgs/{id}/events`:
    ```json
    {
      "platform": "discord",
      "event_type": "VOICE_CALL",
      "external_id": "call-123",
      "occurred_at": "2026-05-15T12:00:00Z",
      "raw_content": {
        "transcript": "User A: Hello. User B: We need to finish the PR by tomorrow. Action Item: Finish the PR."
      }
    }
    ```
2.  **Verify Processing:**
    *   Check Oracle logs for `Processing event ...` and `Summary generated`.
    *   Query `GET /orgs/{id}/artifacts`. You should see a `SUMMARY` type artifact.
    *   Query `GET /orgs/{id}/action-items`. You should see "Finish the PR" as an `OPEN` item.

## 🐳 Phase 5: Orchestration
**Goal:** Full end-to-end validation in the production-like Docker environment.

1.  **Launch Stack:**
    ```powershell
    docker compose up --build -d
    ```
2.  **Check Health:**
    *   `docker ps` should show all services (`nexus-oracle`, `nexus-discord`, `nexus-postgres`, `nexus-ollama`) as `healthy`.
3.  **End-to-End Flow:**
    *   Join a Discord voice channel.
    *   Run `/join`. Speak for a few seconds.
    *   Run `/leave`.
    *   **Success Criteria:**
        1.  Bot posts summary to Discord (Legacy Path).
        2.  `nexus-oracle` logs show the event was received and processed.
        3.  Postgres database contains the new event record and generated artifact.
