# Multi-Platform Architecture

This doc describes how to restructure the codebase from a Discord-only bot into a
shared **core** that can drive summarization for any call platform (Discord,
Slack, Zoom, Google Meet, Teams, file upload, …) via small per-platform
**adapters**, each running as its own process.

It is a design doc, not a task tracker — the current tree still ships only the
Discord bot. The goal of this document is to make the shape of the restructure
unambiguous before any code moves, so that later PRs can reference specific
interfaces and phase numbers.

## Why this restructure

Today, everything in [`src/`](../src/) is reachable from [`src/index.js`](../src/index.js),
and Discord-specific concerns (slash commands, guild IDs, `joinVoiceChannel`,
per-user Opus streams) are interleaved with platform-agnostic concerns
(transcription, summarization, tenant config, audio conversion).

Three forces push us to separate those two layers:

1. **Different platforms expose call audio in very different ways.** See the
   [capability matrix](#platform-capability-matrix) below — what works for
   Discord cannot be assumed for Slack/Zoom/Meet.
2. **A crash in one platform's SDK must not take down the others.** The
   [`@discordjs/voice`](https://github.com/discordjs/voice) stack, the Zoom
   Meeting SDK, and a headless Meet joiner have nothing in common and should
   not share a process.
3. **Adding a platform should not touch the pipeline.** Transcription,
   summarization, and tenant config are already almost-pure functions of
   `(segments, config) → (transcript, summary)`. They deserve to live behind
   interfaces that each platform adapter can reuse unchanged.

## Platform capability matrix

Before designing interfaces, establish what each target platform can actually
deliver. This drives the shape of [`CallAdapter`](#calladapter) — any interface
that assumes "live per-speaker audio" would be wrong for three of five targets.

| Platform       | Live per-speaker audio?                   | Viable ingest path                                            | Speaker labels come from…             |
|----------------|-------------------------------------------|---------------------------------------------------------------|---------------------------------------|
| **Discord**    | ✅ Per-user Opus streams (free)           | `@discordjs/voice` receiver — current implementation          | Platform (trivial)                    |
| **Slack**      | ❌ Huddles not exposed; Calls API signaling only | Post-call recording via Calls/Files API, or ignored for v1 | Diarization model                     |
| **Zoom**       | ⚠️ Only via Meeting SDK / RTMS bot attendee | **Cloud Recording webhook** (`recording.completed`) → download MP4/M4A | Diarization model (SDK path excluded) |
| **Google Meet**| ❌ No public live-audio API               | Meet REST → post-meeting Workspace recording/transcript       | Meet transcript (if available) or diarization |
| **Teams**      | ⚠️ Media Bot SDK only                     | Graph API post-call recording                                 | Diarization model                     |
| **File upload**| N/A                                       | HTTP endpoint — user uploads an audio file                    | Diarization model                     |

**Design consequence:** the right abstraction is not "stream of per-speaker
frames." It is **"produce an array of `SpeakerSegment` by whatever means."**
Discord fills it live; every other adapter fills it by downloading a recording
and (optionally) running diarization.

Diarization itself becomes a new pluggable provider — see
[`DiarizationProvider`](#diarizationprovider-new) below.

## Target layout

```
src/
├── core/                              # platform-agnostic. imports no platform SDKs.
│   ├── interfaces/                    # abstract base classes — methods throw NotImplementedError
│   │   ├── CallAdapter.js
│   │   ├── NotificationSink.js
│   │   ├── CommandGateway.js
│   │   ├── TranscriberProvider.js
│   │   ├── SummarizerLLM.js
│   │   ├── DiarizationProvider.js
│   │   └── TenantConfigStore.js
│   ├── pipeline/
│   │   ├── runSummarization.js        # the post-stop() half of today's leave.js
│   │   ├── buildTranscript.js         # moved from src/summarizer/
│   │   └── summarize.js               # moved from src/summarizer/
│   ├── providers/                     # concrete implementations of core interfaces
│   │   ├── transcription/
│   │   │   ├── whisperCpp.js
│   │   │   └── openaiWhisper.js
│   │   ├── llm/
│   │   │   └── ollama.js
│   │   ├── diarization/
│   │   │   └── pyannote.js            # stub until needed
│   │   └── config/
│   │       └── sqliteTenantStore.js   # generalized guildConfig
│   ├── registry.js                    # factories: getTranscriber(cfg), getLLM(cfg), …
│   └── utils/                         # logger, audio conversion, crypto
│
├── platforms/                         # one folder per platform. imports core, never a peer.
│   ├── discord/
│   │   ├── entrypoint.js              # what src/index.js does today
│   │   ├── DiscordCallAdapter.js      # wraps current VoiceSession
│   │   ├── DiscordNotificationSink.js # posts to summary channel w/ attachment
│   │   ├── DiscordCommandGateway.js   # slash-command registration + dispatch
│   │   └── commands/ …                # /join /leave /config /help
│   ├── slack/
│   │   ├── entrypoint.js              # Bolt app, Events API
│   │   ├── SlackRecordingAdapter.js   # ingests post-call recording URL
│   │   ├── SlackNotificationSink.js   # Block Kit
│   │   └── commands/ …
│   ├── zoom/
│   │   ├── entrypoint.js              # webhook listener for recording.completed
│   │   ├── ZoomRecordingAdapter.js    # download → diarize → segments
│   │   └── SlackOrEmailNotificationSink.js
│   ├── meet/
│   │   ├── entrypoint.js              # polls Meet REST for new conferenceRecords
│   │   └── MeetRecordingAdapter.js
│   └── fileupload/                    # platform #2 — validates the boundary
│       ├── entrypoint.js              # HTTP server, POST /summarize
│       └── UploadAdapter.js
│
├── bin/                               # thin launch scripts, one per platform
│   ├── start-discord.js
│   ├── start-slack.js
│   ├── start-zoom.js
│   ├── start-meet.js
│   └── start-fileupload.js
│
└── index.js                           # re-exports bin/start-discord.js for backward compatibility
```

Rules of thumb:

- **`core/` imports no platform SDK.** No `discord.js`, no `@slack/bolt`, no
  Zoom SDK ever appears under `core/`. Enforced by ESLint (`no-restricted-imports`).
- **Platforms do not import each other.** `platforms/slack` never requires
  `platforms/discord`. Shared code lives in `core/` or it does not exist.
- **`bin/` contains no logic** — each script is `require('../src/platforms/<p>/entrypoint').start()`.
  This keeps `Dockerfile`'s `CMD` single-line and lets docker-compose pick
  which platform runs.

## Interface definitions

JavaScript has no native abstract-base-class construct, so each interface is a
**class whose unimplemented methods throw `NotImplementedError`**. This gives
us a loud failure at runtime when an adapter forgets a method, without
requiring TypeScript. A [TypeScript migration](#open-decisions) remains an open
decision and would replace these with real `interface` declarations.

```js
// src/core/interfaces/_abstract.js
class NotImplementedError extends Error {
  constructor(method) {
    super(`${method} must be implemented by subclass`);
    this.name = 'NotImplementedError';
  }
}
module.exports = { NotImplementedError };
```

### `CallAdapter`

Represents a single in-progress or completed call on a platform. The pipeline
does not care whether segments come from live Discord streams or a downloaded
Zoom MP4 — only that `stop()` resolves to an array of `SpeakerSegment`.

```js
// src/core/interfaces/CallAdapter.js
class CallAdapter {
  /**
   * @param {object} ctx
   * @param {string} ctx.platform        // 'discord' | 'slack' | 'zoom' | ...
   * @param {string} ctx.tenantId        // guild / workspace / account ID
   * @param {string} ctx.callId          // channel ID, meeting ID, file upload ID
   * @param {string} ctx.outDir          // scratch dir for PCM/WAV files
   * @param {(id: string) => Promise<string>} ctx.resolveDisplayName
   */
  constructor(ctx) { this.ctx = ctx; }

  /** Begin capturing. Resolves once ready to receive audio. */
  async start() { throw new NotImplementedError('start'); }

  /**
   * Stop capturing and return all segments produced during this call.
   * @returns {Promise<SpeakerSegment[]>}
   */
  async stop() { throw new NotImplementedError('stop'); }
}

/**
 * @typedef {object} SpeakerSegment
 * @property {string} userId        platform-local user ID (or diarization-assigned ID)
 * @property {string} displayName   human label for the transcript
 * @property {number} startMs       ms from call start
 * @property {number} endMs         ms from call start
 * @property {string} pcmPath       path to raw PCM file on disk (16kHz mono or 48kHz stereo, declared by adapter)
 * @property {number} size          bytes — used to filter segments below MIN_SEGMENT_BYTES
 */
```

**Discord implementation** wraps the existing
[`VoiceSession`](../src/voice/voiceSession.js). `start()` calls `session.start()`;
`stop()` calls `session.stop()` and returns its `segments` array (shape is
already compatible).

**Zoom / Meet implementation** is passive — `start()` is a no-op (the call
already happened); `stop()` downloads the recording, runs
[`DiarizationProvider`](#diarizationprovider-new) against it, and returns the
resulting segments.

### `NotificationSink`

Abstracts "post the summary + transcript somewhere." Discord posts to a text
channel with an attachment; Slack uses Block Kit; Zoom might email or DM; the
file-upload adapter returns it in the HTTP response.

```js
// src/core/interfaces/NotificationSink.js
class NotificationSink {
  /**
   * @param {object} payload
   * @param {string} payload.header       e.g. "Call summary — requested by @alice"
   * @param {string} payload.summary      markdown, LLM-produced
   * @param {string} payload.transcript   full transcript text — usually an attachment
   * @param {object} payload.context      platform-specific routing (channel ID, thread ts, email, …)
   */
  async post(payload) { throw new NotImplementedError('post'); }
}
```

### `CommandGateway`

Each platform has a different "how do I ask the bot to join / leave / configure"
shape: Discord slash commands, Slack slash commands + Events API, Zoom webhooks
(no user commands — everything is recording-triggered), Meet REST polling, HTTP
upload. Trying to unify these into a single command abstraction produces a
lowest-common-denominator mess, so the interface is deliberately **thin**:

```js
// src/core/interfaces/CommandGateway.js
class CommandGateway {
  /** Start listening for platform events. Long-lived. */
  async start() { throw new NotImplementedError('start'); }
  /** Graceful shutdown. */
  async stop() { throw new NotImplementedError('stop'); }
}
```

Each adapter implements `CommandGateway` however makes sense for its platform.
`platforms/zoom` may not use it at all — its entrypoint is an HTTP server, not
a gateway.

### `TranscriberProvider`

Already exists in spirit at [`src/transcription/index.js`](../src/transcription/index.js).
Formalize as:

```js
class TranscriberProvider {
  /**
   * @param {string} wavPath
   * @returns {Promise<{ text?: string, segments?: Array<{ startMs: number, endMs: number, text: string }> }>}
   */
  async transcribe(wavPath) { throw new NotImplementedError('transcribe'); }
}
```

Current `whispercpp` and `openai` providers already match this shape — they
just need to extend the class.

### `SummarizerLLM`

Already exists at [`src/llm/index.js`](../src/llm/index.js). Formalize as:

```js
class SummarizerLLM {
  /**
   * @param {{ role: 'system'|'user'|'assistant', content: string }[]} messages
   * @returns {Promise<string>}
   */
  async chat(messages) { throw new NotImplementedError('chat'); }
}
```

### `DiarizationProvider` (new)

Needed for every adapter **except Discord and file-upload-with-speaker-tags**.
A platform-independent speaker-labeling step sits between "downloaded
composite audio file" and `SpeakerSegment[]`.

```js
class DiarizationProvider {
  /**
   * @param {string} wavPath  mono 16kHz input
   * @returns {Promise<Array<{ speakerId: string, startMs: number, endMs: number }>>}
   */
  async diarize(wavPath) { throw new NotImplementedError('diarize'); }
}
```

Candidate first implementation: local
[pyannote-audio](https://github.com/pyannote/pyannote-audio) via a Python
sidecar, or WhisperX if we accept a GPU dependency. Either way it is a
provider swap, not a platform concern.

### `TenantConfigStore`

Generalizes [`src/config/guildConfig.js`](../src/config/guildConfig.js). Today
the SQLite row key is `guild_id`; a multi-platform bot needs
`(platform, tenant_id)` — a Slack workspace `T01ABCD` and a Zoom account
`XYZ123` can coexist.

```js
class TenantConfigStore {
  /** @returns {TenantConfig} — with defaults applied if the row is new */
  async get({ platform, tenantId }) { throw new NotImplementedError('get'); }
  async update({ platform, tenantId }, patch) { throw new NotImplementedError('update'); }
}
```

**Schema migration** (SQLite):

```sql
-- Migration: guild_config → tenant_config
ALTER TABLE guild_config RENAME TO tenant_config;
ALTER TABLE tenant_config ADD COLUMN platform TEXT NOT NULL DEFAULT 'discord';
ALTER TABLE tenant_config RENAME COLUMN guild_id TO tenant_id;
CREATE UNIQUE INDEX tenant_config_pk ON tenant_config(platform, tenant_id);
```

`DEFAULT 'discord'` is the key — every existing installation migrates with no
user-visible change. The code-path that previously called
`guildConfig.get(interaction.guildId)` becomes
`tenantConfig.get({ platform: 'discord', tenantId: interaction.guildId })`.

## Process model: one process per platform

All entrypoints run **as separate processes** orchestrated by docker-compose:

```
        ┌───────────────────────────────────────────────┐
        │                shared image                   │
        │   (core/ + platforms/* + all node_modules)    │
        └───────────────────────────────────────────────┘
            │             │            │            │
            ▼             ▼            ▼            ▼
      bot-discord    bot-slack    bot-zoom    bot-fileupload
      node bin/      node bin/    node bin/   node bin/
      start-         start-       start-      start-
      discord.js     slack.js     zoom.js     fileupload.js

           all four services ↓ share the same volumes:
              summarizer_bot_data (SQLite, session audio)
              summarizer_whisper_models
              summarizer_ollama_models
```

Benefits:

- **Fault isolation.** A segfault in the Zoom SDK does not page Discord users.
- **Independent scaling.** Spin up only the platforms a given deploy actually
  serves via compose profiles (`docker compose --profile discord --profile zoom up`).
- **Same image, different `CMD`.** Build once, launch five ways. Keeps CI
  simple; no per-platform Docker image proliferation.
- **Single SQLite.** `tenant_config` has a `platform` column, so one DB file
  serves all adapters without any coordination.

Non-benefit / trade-off to accept:

- Each process keeps its own connection pool / model cache. A user running
  Discord + Slack on the same box pays for two Ollama clients, two whisper
  processes, etc. This is the right price to pay for isolation; shared-daemon
  architectures (a single "core service" + thin per-platform RPC clients) are
  **explicitly out of scope for v1** — revisit only if the duplication
  measurably hurts.

### `docker-compose.yml` sketch

```yaml
services:
  bot-discord:
    image: ${BOT_IMAGE}
    command: ["node", "bin/start-discord.js"]
    env_file: .env
    environment: { PLATFORM: discord }
    volumes: [bot_data:/app/data, whisper_models:/opt/whisper-models:ro]
    depends_on: [ollama]
    profiles: [discord]

  bot-slack:
    image: ${BOT_IMAGE}
    command: ["node", "bin/start-slack.js"]
    env_file: .env
    environment: { PLATFORM: slack }
    volumes: [bot_data:/app/data, whisper_models:/opt/whisper-models:ro]
    depends_on: [ollama]
    profiles: [slack]

  bot-zoom:
    image: ${BOT_IMAGE}
    command: ["node", "bin/start-zoom.js"]
    env_file: .env
    environment: { PLATFORM: zoom }
    volumes: [bot_data:/app/data, whisper_models:/opt/whisper-models:ro]
    depends_on: [ollama]
    ports: ["127.0.0.1:8081:8081"]     # receives Zoom webhooks via reverse proxy
    profiles: [zoom]

  # … bot-meet, bot-fileupload follow the same pattern

  ollama: { /* unchanged from today */ }
```

## Phased migration

Each phase leaves `npm start` working. No phase has a long-lived branch.

### Phase 0 — Docs and guardrails (this doc)

- Land this doc.
- Add an ESLint `no-restricted-imports` rule for paths under `src/core/` that
  forbids any `discord.js`, `@discordjs/*`, `@slack/*`, Zoom SDK, etc. import.
  The rule fails CI the moment platform code leaks into core — cheap insurance.

### Phase 1 — Extract the pipeline (no behavior change)

- Move the post-`session.stop()` half of [`src/commands/leave.js`](../src/commands/leave.js)
  into `src/core/pipeline/runSummarization.js`. Signature:
  ```js
  async function runSummarization({
    segments,       // SpeakerSegment[]
    tenantConfig,   // today's guildConfig row, unchanged
    transcriber,    // TranscriberProvider
    llm,            // SummarizerLLM
    sink,           // NotificationSink
    sinkContext,    // whatever the sink needs
    logger,
  }) { /* transcribe → build transcript → summarize → sink.post(...) */ }
  ```
- `leave.js` shrinks to: call `session.stop()`, build `sinkContext` from the
  Discord interaction, call `runSummarization`.
- Move `src/summarizer/*` into `src/core/pipeline/`.
- Move `src/llm/` into `src/core/providers/llm/`.
- Move `src/transcription/` into `src/core/providers/transcription/`.
- All file renames only; no logic changes.

### Phase 2 — Introduce interfaces, one adapter each

- Add `src/core/interfaces/*.js` with `NotImplementedError` base classes.
- Make existing providers `extend` their interface class. Adapters that
  already match the shape need zero logic changes.
- Introduce `CallAdapter` and wrap `VoiceSession` in `DiscordCallAdapter`.
  `join.js` becomes: construct the adapter, call `adapter.start()`, register
  it in the session manager.
- Introduce `NotificationSink` and wrap "post to summary channel" in
  `DiscordNotificationSink`.

### Phase 3 — Generalize tenant config

- Apply the SQL migration above.
- Rename `src/config/guildConfig.js` → `src/core/providers/config/sqliteTenantStore.js`.
- Update every caller to pass `{ platform: 'discord', tenantId }`. This is a
  mechanical rewrite — the map of callers is the one produced by
  `grep -rn "guildConfig" src/`.

### Phase 4 — Split the Discord entrypoint

- Create `src/platforms/discord/entrypoint.js` containing what
  [`src/index.js`](../src/index.js) does today.
- Create `bin/start-discord.js` as a two-line launcher.
- Reduce `src/index.js` to `require('./platforms/discord/entrypoint').start()`
  for backward compatibility — `npm start` still works, existing systemd unit
  files still work, existing `Dockerfile` still works.
- Update `docker-compose.yml` to use `bin/start-discord.js` with a `discord`
  profile. Default profile stays backwards-compatible.

### Phase 5 — Prove the boundary with a second adapter

Implement **`platforms/fileupload`** before any real third-party platform.

- HTTP server on port 8080. `POST /summarize` accepts `multipart/form-data`
  with an audio file.
- `UploadAdapter.start()` is a no-op; `stop()` returns a single
  `SpeakerSegment` covering the whole file (or runs diarization if present).
- `NotificationSink` returns the summary + transcript in the HTTP response.

This validates every interface under a caller that shares *nothing* with
Discord — no gateway, no slash commands, no voice SDK — without getting stuck
on real-world platform auth and SDK quirks. Any interface defect the fileupload
adapter surfaces would have surfaced with Zoom too, three weeks later.

### Phase 6 — First real third-party platform

Pick based on actual user demand, but the recommended first target is **Zoom
Cloud Recording webhook**:

- `platforms/zoom/entrypoint.js` runs an HTTPS webhook listener.
- On `recording.completed` events, download the composite audio file.
- `ZoomRecordingAdapter.stop()` runs `DiarizationProvider`, returns segments.
- Reuses the entire pipeline unchanged.

Why Zoom first (ahead of Slack): the Slack live-audio problem has no clean
solution, and post-call recording is not reliably available in most Slack
plans. Zoom Cloud Recording is a well-defined webhook with real audio
attached.

### Phase 7 — Polish & hardening

- Per-platform README sections under `docs/platforms/` describing auth setup
  for each provider.
- Per-process `/healthz` endpoint (file-upload already has one; add HTTP
  server to gateway-based platforms gated by an env flag).
- Metrics: `summaries_total{platform="discord"}`, etc., via a cheap Prometheus
  text exposition on a separate port.

## What each platform adapter must answer

Every new adapter PR should explicitly address the following. If the answer to
any of these is "unclear", the adapter is not ready to merge.

1. **How does the bot learn that a new call happened?**
   - Discord: user runs `/join`.
   - Slack: Events API `call_rejected` / dedicated `/summarize` slash command
     pointing at an already-finished call.
   - Zoom: webhook `recording.completed`.
   - Meet: poll `conferenceRecords.list` on a schedule.
   - File upload: inbound HTTP request.
2. **Where does the audio come from?** URL, SDK, local file, live socket.
3. **Who are the speakers?** Platform-provided labels, diarization, or
   "single unknown speaker."
4. **Where does the summary go?** Same platform, different platform (e.g. Zoom
   → email), or returned synchronously.
5. **How is the tenant identified?** Discord guild ID, Slack team ID, Zoom
   account UUID, Meet Workspace ID — each becomes `tenantId` in
   `TenantConfigStore`.
6. **How is per-tenant authentication handled?** Bot token in `.env`
   (Discord), OAuth install flow (Slack, Zoom, Meet), API key (file upload).
   Never commingle tenant auth with `ENCRYPTION_KEY`.

## Things we deliberately do not do

- **A unified command/interaction interface across platforms.** Discord slash
  commands, Slack Block Kit, Zoom webhooks, and HTTP uploads have too little
  in common. Each platform owns its own command handling; only the pipeline is
  shared. An abstraction that tried to unify them would harm all four.
- **A shared "core service" daemon with per-platform RPC clients.** Tempting,
  especially for expensive shared state like the Ollama client pool and
  whisper model cache. Don't. One-process-per-platform is simpler, isolates
  faults, and the duplication is cheap until it isn't — revisit only if
  measured cost demands it.
- **Pre-building adapters for Slack/Zoom/Meet in parallel.** Interfaces that
  were not pressure-tested by at least one non-Discord caller will be wrong.
  Implement `fileupload` first (Phase 5), *then* generalize against whatever
  real third-party adapter follows.
- **Renaming the SQLite table without a migration.** Existing Oracle Cloud /
  home-server installs have real data in `guild_config`. The ALTER sequence
  above preserves all of it.
- **Moving Discord command code into `core/`.** Slash-command registration
  with `REST`, `SlashCommandBuilder`, `Events.InteractionCreate` etc. belongs
  in `platforms/discord/` permanently. `core/` stays SDK-free.

## Open decisions

These are not blockers for Phase 1 but should be settled before Phase 5.

| Decision                                    | Options                                                    | Recommendation                                                  |
|---------------------------------------------|------------------------------------------------------------|-----------------------------------------------------------------|
| JS vs TypeScript for the interface layer    | Keep JS with throw-based ABCs / migrate `src/core/` to TS  | **TypeScript** — real interfaces pay off quickly with ≥3 adapters, and `core/` is the natural migration slice |
| Diarization provider                        | pyannote-audio sidecar / WhisperX / cloud API              | Defer until Phase 6 requires it — design the interface now     |
| Tenant auth storage for OAuth platforms     | Add OAuth token columns to `tenant_config` / separate table | Separate `tenant_auth` table, encrypted same as `stt_api_key`  |
| Health / metrics surface                    | None / Prometheus text / OpenTelemetry                     | Prometheus text on a per-process port — cheapest useful option |
| Logger scope propagation                    | Thread `platform` into every `createLogger` child          | Yes — `createLogger('main').child({ platform: 'zoom' })`       |

## Cross-references

- Current Discord implementation: [`src/index.js`](../src/index.js),
  [`src/commands/`](../src/commands/), [`src/voice/voiceSession.js`](../src/voice/voiceSession.js).
- Production deploy model: [`docs/docker.md`](docker.md) — the multi-service
  sketch above extends that same compose file.
- Hosting considerations per platform: [`docs/hosting.md`](hosting.md) already
  covers the Discord bot; per-platform auth setup will get its own pages
  under `docs/platforms/` as adapters land.
