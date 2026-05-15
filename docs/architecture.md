# Nexus — Central AI Oracle: Architecture & Implementation Plan

## Current State Inventory

| Layer | Files | Tech | Health |
|---|---|---|---|
| Interfaces | 10 contracts in `src/core/interfaces/` | JS abstract classes | Clean, adapter-pattern |
| Pipeline | `runSummarization.js`, `buildTranscript.js`, `summarize.js` | Platform-agnostic | Good separation |
| Providers | Ollama LLM, whisper.cpp + OpenAI Whisper STT | Factory in `registry.js` | Works |
| DB | `better-sqlite3` via `SqliteDatabaseProvider` | Raw SQL everywhere | **Debt** — no ORM, inline migrations |
| Config | `SqliteTenantStore`, `SqliteChannelConfigStore` | Raw SQL | Flat tenancy (platform + tenant_id) |
| Discord | `VoiceSession` (per-speaker Opus), commands, `DiscordCallAdapter` | `@discordjs/voice` + `@discordjs/opus` | **Critical path** — no Python equivalent |
| Slack | Channel summaries, scheduled digests, `/summarize`, `/report` | `@slack/bolt` | Works |
| Crypto | AES-256-GCM vault in `crypto.js` | Node `crypto` | Good pattern, port to Python |
| Infra | Multi-stage Dockerfile (whisper.cpp from source), Compose with Ollama sidecar | Multi-arch CI/CD to GHCR | Solid |

---

## Architecture Options Evaluation

### Option A — Full Python Migration

| Dimension | Assessment |
|---|---|
| **What breaks** | Discord per-speaker Opus capture. `discord.py` has no equivalent to `@discordjs/voice` receiver with per-user subscribe + Opus decode. You'd need to write a custom C extension or use `pynacl` raw — months of work with no community support. **This is a dealbreaker.** |
| **Migration path** | Rewrite ~2,500 LoC of adapter code, rewrite all pipeline code, rewrite DB layer. Everything moves at once. |
| **Operational complexity** | Single language (good), but the Discord voice gap means you'd ship a degraded product or block on a risky custom implementation. |
| **Ship timeline** | 8-12 weeks minimum, with the Discord voice risk potentially extending indefinitely. |
| **Verdict** | **Reject.** The Discord voice capture gap is not solvable in reasonable time. |

### Option B — Python Oracle + Node.js Adapters ⭐ RECOMMENDED

| Dimension | Assessment |
|---|---|
| **What breaks** | Nothing critical. Adapters keep working. Pipeline logic moves to Python but the interface contract stays. DB access centralizes in the oracle. |
| **Migration path** | Incremental: (1) Stand up Python oracle with new schema, (2) Add HTTP client to Node adapters to POST events inward, (3) Oracle processes async, (4) Adapters become stateless shells. Old SQLite stores can coexist during transition. |
| **Operational complexity** | Two runtimes, but cleanly separated: Node.js adapters are I/O shells, Python oracle is the brain. One extra container in Compose. Internal HTTP is simple and debuggable. |
| **Ship timeline** | Phase 1 (oracle + schema + API) in ~2 weeks. Phase 2 (adapter rewiring) in ~1 week. Phase 3 (intelligence pipeline) in ~2 weeks. Full stack in ~6 weeks. |
| **Verdict** | **Recommended.** Best of both worlds — Python's ML/NLP ecosystem for intelligence, Node.js's unmatched Discord voice support stays untouched. |

### Option C — Node.js Primary + Python Sidecar

| Dimension | Assessment |
|---|---|
| **What breaks** | Nothing immediately, but you end up with two ORMs (Prisma in Node, SQLAlchemy or raw in Python sidecar), two auth systems, and the "brain" logic split across languages. |
| **Migration path** | Easiest start — add a Python container, call it from Node. But the knowledge graph, event normalization, and insight generation all naturally belong in Python, and forcing them through a Node.js API layer adds unnecessary indirection. |
| **Operational complexity** | Highest long-term. Every new intelligence feature requires coordinating across two codebases. The Python sidecar grows to become the real product, making the Node.js "primary" a misnomer. |
| **Ship timeline** | 3-4 weeks for initial sidecar, but tech debt compounds. By month 3 you'd want to refactor to Option B anyway. |
| **Verdict** | **Reject for greenfield pivot.** Good for adding inference to an existing Node app, but Nexus is a new product where Python should own the brain. |

---

## Recommended Architecture: Option B

```mermaid
graph TB
  subgraph "Adapters (Node.js)"
    DA["Discord Adapter<br/>@discordjs/voice<br/>Opus capture"]
    SA["Slack Adapter<br/>@slack/bolt<br/>Channel digests"]
    ZA["Future: Zoom, Teams..."]
  end

  subgraph "Oracle (Python FastAPI)"
    API["REST API<br/>JWT Auth + RBAC"]
    SVC["Services Layer<br/>EventService, ArtifactService<br/>IdentityService"]
    REPO["Repositories<br/>OrgRepo, EventRepo<br/>ArtifactRepo, UserRepo"]
    PIPE["Intelligence Pipeline<br/>Transcription → Summary<br/>→ Action Items → Insights"]
    Q["Task Queue<br/>asyncio (v1)<br/>→ Celery (v2)"]
  end

  subgraph "Storage"
    DB[(PostgreSQL / SQLite)]
    OBJ["Object Storage<br/>(audio files)"]
  end

  subgraph "AI Services"
    OL["Ollama"]
    WH["faster-whisper"]
  end

  DA -->|"POST /orgs/{id}/events"| API
  SA -->|"POST /orgs/{id}/events"| API
  ZA -.->|"POST /orgs/{id}/events"| API
  API --> SVC
  SVC --> REPO
  SVC --> Q
  REPO --> DB
  Q --> PIPE
  PIPE --> WH
  PIPE --> OL
  PIPE --> REPO
```

---

## Project Structure

```
nexus/
├── oracle/                          # Python FastAPI — the brain
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                  # FastAPI app factory
│   │   ├── config.py                # Pydantic Settings
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── deps.py              # Dependency injection (get_db, get_current_user)
│   │   │   └── routes/
│   │   │       ├── orgs.py
│   │   │       ├── events.py
│   │   │       ├── artifacts.py
│   │   │       ├── action_items.py
│   │   │       ├── platform_links.py
│   │   │       ├── insights.py
│   │   │       └── auth.py
│   │   ├── services/
│   │   │   ├── event_service.py
│   │   │   ├── artifact_service.py
│   │   │   ├── identity_service.py
│   │   │   ├── crypto_service.py
│   │   │   └── intelligence/
│   │   │       ├── pipeline.py      # Orchestrator
│   │   │       ├── transcriber.py   # faster-whisper + OpenAI
│   │   │       ├── summarizer.py    # Ollama / OpenAI LLM
│   │   │       └── insight_engine.py
│   │   ├── repositories/
│   │   │   ├── base.py              # BaseRepository with org_id scoping
│   │   │   ├── org_repo.py
│   │   │   ├── user_repo.py
│   │   │   ├── event_repo.py
│   │   │   ├── artifact_repo.py
│   │   │   └── action_item_repo.py
│   │   ├── models/                  # SQLAlchemy ORM models
│   │   │   ├── base.py
│   │   │   ├── org.py
│   │   │   ├── user.py
│   │   │   ├── team.py
│   │   │   ├── event.py
│   │   │   ├── artifact.py
│   │   │   ├── platform.py
│   │   │   └── enums.py
│   │   ├── schemas/                 # Pydantic request/response
│   │   │   ├── org.py
│   │   │   ├── event.py
│   │   │   ├── artifact.py
│   │   │   └── auth.py
│   │   └── core/
│   │       ├── auth.py              # JWT encode/decode, RBAC
│   │       ├── crypto.py            # AES-256-GCM (port of Node crypto.js)
│   │       ├── logging.py
│   │       └── queue.py             # AsyncTaskQueue interface
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/               # Migration files
│   ├── alembic.ini
│   ├── pyproject.toml
│   ├── Dockerfile
│   └── tests/
├── adapters/
│   ├── discord/                     # Existing Node.js code, slimmed
│   │   ├── src/
│   │   │   ├── entrypoint.js
│   │   │   ├── voiceSession.js      # Unchanged
│   │   │   ├── commands/
│   │   │   └── oracleClient.js      # NEW: HTTP client to oracle API
│   │   └── package.json
│   └── slack/                       # Existing Node.js code, slimmed
│       ├── src/
│       │   ├── entrypoint.js
│       │   ├── commands/
│       │   └── oracleClient.js      # NEW: HTTP client to oracle API
│       └── package.json
├── src/core/                        # Shared Node.js code (legacy, removed in Phase 3)
├── docs/
│   └── architecture.md              # This file
├── docker-compose.yml               # Oracle + adapters + Ollama + Postgres
├── .env.example
└── README.md
```

---

## Implementation Phases

### Phase 0: Repository Restructure & Monorepo Setup ✅ COMPLETE
**Duration:** 1 day | **Risk:** Low

| Step | Deliverable | Status |
|---|---|---|
| 0.1 | Create `oracle/` and `adapters/{discord,slack}/` directories | ✅ Done |
| 0.2 | Move `src/platforms/discord/` → `adapters/discord/src/` | ✅ Done — `voiceSession.js` byte-identical |
| 0.3 | Move `src/platforms/slack/` → `adapters/slack/src/` | ✅ Done — all Slack commands preserved |
| 0.4 | Split `package.json` into per-adapter packages | ✅ Done — `@nexus/discord-adapter`, `@nexus/slack-adapter` |
| 0.5 | Update root entry points (`src/index.js`, `bin/`) | ✅ Done — paths point to `adapters/` |
| 0.6 | Initialize `oracle/` Python project | ✅ Done — FastAPI app, 11 ORM models, Alembic migration, 6 repositories, 12 API routes, crypto vault, task queue |
| 0.7 | PostgreSQL via docker-compose | ✅ Done — `postgres:16-alpine` on port 5433, migration verified against both SQLite and Postgres |

> [!IMPORTANT]
> Phase 0 produced zero behavior changes. All existing commands still work. This was a pure structural refactor.

### Phase 1: Oracle Foundation — Models, Migrations, Repositories ✅ COMPLETE (merged into Phase 0)
**Duration:** 4-5 days | **Risk:** Medium

> [!NOTE]
> Phase 1 deliverables were completed during Phase 0 since they are foundational to the oracle setup. All items below are done.

| Step | Deliverable | Status |
|---|---|---|
| 1.1 | `oracle/app/config.py` — Pydantic Settings | ✅ `DATABASE_URL` supports Postgres + SQLite, `ENCRYPTION_KEY`, `JWT_SECRET`, etc. |
| 1.2 | `oracle/app/models/base.py` — DeclarativeBase, UUIDMixin, TimestampMixin | ✅ |
| 1.3 | `oracle/app/models/enums.py` — All enum types | ✅ Platform, EventType, ArtifactType, ActionItemStatus, OrgRole, TeamRole |
| 1.4 | All ORM models (11 tables) | ✅ Org, Team, User, OrgMember, TeamMember, PlatformLink, PlatformIdentity, Event, EventParticipant, Artifact, ActionItem |
| 1.5 | Alembic init + initial migration | ✅ Autogenerated, tested against both SQLite and PostgreSQL |
| 1.6 | `oracle/app/repositories/base.py` — org-scoped base | ✅ `OrgScopedRepository` auto-injects `WHERE org_id = :org_id` |
| 1.7 | All repository classes | ✅ OrgRepo, UserRepo, EventRepo, ArtifactRepo, ActionItemRepo |
| 1.8 | `oracle/app/core/crypto.py` — AES-256-GCM vault | ✅ Wire-compatible `v1:iv:tag:ct` format |

### Phase 2: Oracle API — Auth, Routes, Validation
**Duration:** 3-4 days | **Risk:** Medium

| Step | Deliverable | Details |
|---|---|---|
| 2.1 | `oracle/app/core/auth.py` | JWT creation/validation. `get_current_user` dependency. `require_org_role(min_role)` dependency that checks `OrgMember` table. |
| 2.2 | `oracle/app/api/deps.py` | `get_async_session` (yields SQLAlchemy `AsyncSession`), `get_org_repo`, `get_event_repo`, etc. — all FastAPI `Depends()` factories. |
| 2.3 | Pydantic schemas | Request/response models for every route. Strict validation, `model_config = ConfigDict(from_attributes=True)`. |
| 2.4 | `POST /orgs` | Create org, auto-assign creator as OWNER. |
| 2.5 | `POST /orgs/{org_id}/platform-links` | Register platform integration, encrypt credentials. |
| 2.6 | `POST /orgs/{org_id}/events` | **Core ingest endpoint.** Accepts normalized event payload from adapters. Persists `Event` + `EventParticipant` rows. Enqueues intelligence job. Returns `202 Accepted`. |
| 2.7 | `GET /orgs/{org_id}/events` | Paginated, filterable (type, team, date range). Cursor-based pagination. |
| 2.8 | `GET /orgs/{org_id}/events/{event_id}` | Event detail with nested artifacts. |
| 2.9 | `GET /orgs/{org_id}/artifacts` | Cross-event artifact query. Filter by `artifact_type`. |
| 2.10 | `GET /orgs/{org_id}/action-items` + `PATCH` | Action items CRUD with status/assignee filters. |
| 2.11 | `GET /orgs/{org_id}/insights/summary` | **Stub** — returns placeholder JSON. Scaffold the route and Pydantic schema for future intelligence. |
| 2.12 | Error handling middleware | Structured error responses: `{"error": {"code": "...", "message": "...", "details": [...]}}`. |
| 2.13 | `oracle/app/main.py` | App factory, lifespan handler (DB engine create/dispose), CORS, mount routes. |

### Phase 3: Adapter Rewiring — Stateless Shells
**Duration:** 3-4 days | **Risk:** High (touches working code)

| Step | Deliverable | Details |
|---|---|---|
| 3.1 | `adapters/discord/src/oracleClient.js` | HTTP client wrapping `undici.fetch`. Methods: `postEvent(orgId, payload)`, `getConfig(orgId)`, `resolveIdentity(platform, externalId)`. Reads `ORACLE_URL` from env. Includes retry logic (3 attempts, exponential backoff). |
| 3.2 | Modify Discord `/join` flow | After `VoiceSession.stop()` returns segments, instead of running `runSummarization()` locally: (1) Upload audio segments to oracle (or shared volume), (2) POST normalized event to oracle, (3) Oracle processes async, (4) Discord adapter polls or receives webhook for completion, posts result to channel. |
| 3.3 | Modify Discord `/leave` | Same rewire — capture stays local, processing goes to oracle. |
| 3.4 | `adapters/slack/src/oracleClient.js` | Same HTTP client pattern. |
| 3.5 | Modify Slack `/summarize` | Fetch channel messages locally (Slack API), POST as event to oracle, oracle summarizes, adapter posts result. |
| 3.6 | Modify Slack `/report` | Same pattern. |
| 3.7 | Identity resolution on ingest | Adapters include `platform_identity: { platform: "discord", external_id: "snowflake_123" }` in event payloads. Oracle resolves to Nexus user or parks as unresolved. |
| 3.8 | Adapter config via oracle | Replace local `SqliteTenantStore` reads with oracle API calls. Adapters no longer need direct DB access. |

> [!CAUTION]
> Phase 3 is the highest-risk phase. Use feature flags: `USE_ORACLE=true|false` in adapter env. When false, the old local pipeline runs. When true, events go to the oracle. This enables gradual rollout and instant rollback.

### Phase 4: Intelligence Pipeline in Oracle
**Duration:** 5-7 days | **Risk:** Medium

| Step | Deliverable | Details |
|---|---|---|
| 4.1 | `oracle/app/core/queue.py` | `AsyncTaskQueue` interface with `enqueue(job_type, payload)` and `process()`. V1 implementation: `asyncio.create_task()` with a bounded semaphore. Interface designed for drop-in Celery/BullMQ replacement. |
| 4.2 | `oracle/app/services/intelligence/transcriber.py` | `TranscriberService` supporting `faster-whisper` (local) and OpenAI Whisper API. Config-driven provider selection per org. |
| 4.3 | `oracle/app/services/intelligence/summarizer.py` | `SummarizerService` wrapping Ollama and OpenAI chat completions. Prompt templates ported from `discord/prompts.js` and `slack/prompts.js`. |
| 4.4 | `oracle/app/services/intelligence/pipeline.py` | `IntelligencePipeline.process_event(event_id)`: (1) Load event + raw content, (2) Transcribe if audio, (3) Summarize, (4) Extract action items via LLM, (5) Write `Artifact` rows, (6) Notify originating adapter. |
| 4.5 | Action item extraction | LLM prompt that extracts structured action items from summaries. Parse into `ActionItem` rows with assignee resolution. |
| 4.6 | `oracle/app/services/identity_service.py` | `IdentityService.resolve(platform, external_id) -> User?`. `link_identity(user_id, platform, external_id)`. Retroactive linking: when a user connects, update all `EventParticipant` rows with null `user_id` that match the platform identity. |
| 4.7 | Webhook notification to adapters | After pipeline completion, POST result to adapter callback URL (provided in original event payload). Adapter then posts to Discord/Slack channel. |

### Phase 5: Docker & CI/CD
**Duration:** 2-3 days | **Risk:** Low

| Step | Deliverable | Details |
|---|---|---|
| 5.1 | `oracle/Dockerfile` | Python 3.11-slim, multi-stage. Optional `faster-whisper` with CUDA support via build arg. |
| 5.2 | `adapters/discord/Dockerfile` | Slimmed version of current Dockerfile. Keeps whisper.cpp build stage (for fallback local inference). |
| 5.3 | `adapters/slack/Dockerfile` | Simple Node.js image, no native deps needed. |
| 5.4 | `docker-compose.yml` | Services: `oracle`, `discord-adapter`, `slack-adapter`, `ollama`, `whisper-models-init`, `ollama-models-init`, `postgres` (with SQLite fallback). Internal `backend` network. |
| 5.5 | Update CI workflows | Build and push three images. Multi-arch maintained. |
| 5.6 | `docker-compose.dev.yml` | Dev overrides: SQLite, volume mounts for hot reload, `ORACLE_URL=http://oracle:8000`. |
| 5.7 | Health checks | Oracle: `GET /health`. Adapters: filesystem marker (existing pattern). Postgres: `pg_isready`. |

### Phase 6: Polish & Hardening
**Duration:** 2-3 days | **Risk:** Low

| Step | Deliverable | Details |
|---|---|---|
| 6.1 | OpenAPI docs | FastAPI auto-generates. Add descriptions, examples, tags. |
| 6.2 | Data migration script | One-time script to migrate existing `tenant_config` + `slack_channel_config` data from SQLite into the new oracle schema. Maps flat `tenant_id` to `Org` + `PlatformLink`. |
| 6.3 | `.env.example` update | Document all new env vars for oracle + adapters. |
| 6.4 | `README.md` rewrite | New architecture diagram, quickstart, deployment guide. |
| 6.5 | Type hardening labels | Mark all stubs with `# STUB: <description>` comments. List where TypeScript (adapters) and stricter Pydantic (oracle) would add value. |
| 6.6 | Integration smoke tests | `pytest` tests that spin up the oracle with SQLite, POST an event, verify artifacts are created. |

---

## Schema ER Diagram

```mermaid
erDiagram
    Org ||--o{ Team : has
    Org ||--o{ OrgMember : has
    Org ||--o{ PlatformLink : has
    Org ||--o{ Event : has
    Org ||--o{ Artifact : has
    Org ||--o{ ActionItem : has

    Team ||--o{ TeamMember : has
    Team ||--o{ Event : scoped_to

    User ||--o{ OrgMember : belongs
    User ||--o{ TeamMember : belongs
    User ||--o{ PlatformIdentity : identified_by
    User ||--o{ ActionItem : assigned

    Event ||--o{ EventParticipant : has
    Event ||--o{ Artifact : produces

    Artifact ||--o{ ActionItem : contains

    Org {
        uuid id PK
        string slug UK
        string display_name
        timestamp created_at
        timestamp updated_at
    }

    Team {
        uuid id PK
        uuid org_id FK
        string slug
        string display_name
    }

    User {
        uuid id PK
        string email UK
        string name
    }

    OrgMember {
        uuid org_id PK_FK
        uuid user_id PK_FK
        enum role "OWNER|ADMIN|MEMBER"
    }

    PlatformLink {
        uuid id PK
        uuid org_id FK
        enum platform
        string external_id
        bytes credentials_encrypted
        json config_json
    }

    PlatformIdentity {
        enum platform PK
        string external_id PK
        uuid user_id FK "nullable"
    }

    Event {
        uuid id PK
        uuid org_id FK
        uuid team_id FK "nullable"
        enum platform
        enum event_type
        string external_id
        timestamp occurred_at
        json raw_content_json
    }

    Artifact {
        uuid id PK
        uuid org_id FK
        uuid event_id FK "nullable"
        enum artifact_type
        text content
        json metadata_json
    }

    ActionItem {
        uuid id PK
        uuid artifact_id FK
        uuid org_id FK
        uuid assignee_id FK "nullable"
        string assignee_raw
        string text
        enum status "OPEN|IN_PROGRESS|DONE|CANCELLED"
        timestamp due_at
    }
```

---

## Key Design Decisions

### 1. Org Isolation as Repository Invariant
```python
# Every repository auto-scopes. Callers cannot forget.
class OrgScopedRepository:
    def __init__(self, session: AsyncSession, org_id: UUID):
        self._session = session
        self._org_id = org_id

    def _scoped_select(self):
        return select(self._model).where(self._model.org_id == self._org_id)
```

### 2. Database Provider Switching
```env
# Change this ONE line to switch providers. That's it.
# PostgreSQL (local docker-compose):
DATABASE_URL=postgresql+asyncpg://nexus:nexus@localhost:5433/nexus
# PostgreSQL (hosted):
DATABASE_URL=postgresql+asyncpg://user:pass@your-rds-host.com:5432/nexus
# SQLite (zero-dep fallback):
DATABASE_URL=sqlite+aiosqlite:///./dev.db
```
After switching, run `cd oracle && alembic upgrade head` to apply migrations.

### 3. Adapter ↔ Oracle Communication
```
Discord Adapter                          Oracle
     │                                      │
     │  POST /orgs/{id}/events              │
     │  { event_type: "VOICE_CALL",         │
     │    platform: "discord",              │
     │    external_id: "channel_123",       │
     │    participants: [...],              │
     │    audio_ref: "s3://...",            │
     │    callback_url: "http://..." }      │
     │ ─────────────────────────────────►   │
     │                                      │ 202 Accepted
     │  ◄───────────────────────────────    │
     │                                      │ ... async processing ...
     │                                      │
     │  POST callback_url                   │
     │  { event_id, artifacts: [...] }      │
     │  ◄───────────────────────────────    │
     │                                      │
     │  (adapter posts to Discord channel)  │
```

### 4. Feature Flag for Gradual Migration
```env
# In adapter .env — enables instant rollback
USE_ORACLE=false    # Phase 3 dev: old local pipeline
USE_ORACLE=true     # Phase 3 done: oracle handles everything
```

### 5. Queue Interface for Future Scaling
```python
# V1: asyncio tasks. V2: drop in Celery/Redis.
class TaskQueue(Protocol):
    async def enqueue(self, job_type: str, payload: dict) -> str: ...
    async def get_status(self, job_id: str) -> JobStatus: ...
```

---

## Risk Matrix

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Discord voice capture regression | **Critical** | Low | `voiceSession.js` is byte-preserved; adapter only changes HTTP client layer |
| Crypto format incompatibility | High | Medium | Shared test vectors: encrypt in Node, decrypt in Python |
| SQLite ↔ Postgres migration gaps | Medium | Medium | Alembic `env.py` with dialect-specific hooks; CI tests against both |
| Oracle downtime blocks all adapters | High | Medium | Adapters queue events locally if oracle unreachable; retry with backoff |
| Async pipeline data loss | High | Low | Persist event to DB *before* enqueuing job; job is idempotent replay |

---

## Timeline Summary

| Phase | Duration | Cumulative | Status |
|---|---|---|---|
| Phase 0: Restructure | 1 day | 1 day | ✅ Complete |
| Phase 1: Oracle Foundation | (merged into Phase 0) | ~1 day | ✅ Complete |
| Phase 2: Oracle API | 3-4 days | ~1 week | 🔲 Next |
| Phase 3: Adapter Rewiring | 3-4 days | ~2 weeks | 🔲 |
| Phase 4: Intelligence | 5-7 days | ~3 weeks | 🔲 |
| Phase 5: Docker & CI | 2-3 days | ~3.5 weeks | 🔲 |
| Phase 6: Polish | 2-3 days | **~4 weeks** | 🔲 |

> [!TIP]
> **Recommended shipping strategy:** Ship Phase 0-3 first with `USE_ORACLE=false` as default. This gets the oracle running alongside the existing pipeline with zero user-facing changes. Then flip `USE_ORACLE=true` per-org to validate incrementally before cutting over fully.
