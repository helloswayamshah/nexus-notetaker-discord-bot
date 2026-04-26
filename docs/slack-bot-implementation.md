# Slack Bot Implementation Guide

This document describes how to implement the Slack bot for the AI Call Summarizer. The Slack bot reuses 100% of the core pipeline (transcription, LLM, summarization) — only the platform adapter layer and database driver change.

---

## Feature Scope

1. **Per-channel configuration** — LLM, STT provider, summary destination channel, and a polling interval per source channel.
2. **Scheduled summaries** — The bot polls each configured source channel on its interval and posts a summary of that period's messages to the configured output channel.
3. **Slash command config** — All settings are managed via slash commands (`/aics-config`).
4. **On-demand report** — `/aics-report` lets any authorized user request an immediate summary of a channel over a given time window.

No voice/huddle recording is in scope for this phase.

---

## Architecture Overview

```
src/
├── core/
│   ├── interfaces/
│   │   ├── DatabaseProvider.js        # NEW — abstract DB interface
│   │   └── ChannelConfigStore.js      # NEW — abstract channel-schedule interface
│   └── providers/
│       └── config/
│           ├── sqlite/
│           │   ├── db.js              # MOVED — SQLite driver (was db.js)
│           │   ├── sqliteTenantStore.js
│           │   └── sqliteChannelConfigStore.js   # NEW
│           └── index.js               # NEW — factory: getDb(), getTenantStore(), getChannelStore()
└── platforms/
    └── slack/
        ├── entrypoint.js              # Process entry — token validation, signal handlers
        ├── SlackCommandGateway.js     # Extends CommandGateway; owns Bolt app lifecycle
        ├── SlackNotificationSink.js   # Extends NotificationSink; posts Block Kit messages
        ├── SlackPermissionChecker.js  # Admin/workspace-owner check
        ├── channelScheduler.js        # In-process interval runner
        ├── channelSummary.js          # Fetches message history, builds transcript, summarizes
        └── commands/
            ├── config.js              # /aics-config handler
            ├── report.js              # /aics-report handler
            └── help.js                # /aics-help handler
```

### Reused core modules (zero changes needed)

| Module | Role |
|---|---|
| `src/core/pipeline/runSummarization.js` | Main audio orchestrator (Discord path) |
| `src/core/pipeline/buildTranscript.js` | Formats utterances → text |
| `src/core/pipeline/summarize.js` | LLM summarization |
| `src/core/registry.js` | Factory for transcriber + LLM |
| `src/core/utils/crypto.js` | Encrypts stored API keys |
| `src/core/utils/logger.js` | Scoped logging |

---

## Part 1 — Database Abstraction

The current `db.js` is a module-level SQLite singleton. To make the backend swappable (Postgres, MySQL, etc.) without touching every store or command handler, introduce a thin `DatabaseProvider` interface and a factory that selects the driver from `DB_DRIVER`.

### Step 1a — `DatabaseProvider` interface

Create `src/core/interfaces/DatabaseProvider.js`:

```js
// src/core/interfaces/DatabaseProvider.js
const { NotImplementedError } = require('./_abstract');

/**
 * Minimal interface that store implementations depend on.
 * A driver must implement these four methods; everything else
 * (connection pooling, migrations) is internal to the driver.
 */
class DatabaseProvider {
  /** Run DDL/DML that returns no rows. */
  exec(sql) { throw new NotImplementedError('exec'); }

  /** Return one row or undefined. */
  queryOne(sql, params) { throw new NotImplementedError('queryOne'); }

  /** Return all matching rows. */
  queryAll(sql, params) { throw new NotImplementedError('queryAll'); }

  /** Run an INSERT/UPDATE/DELETE. Returns { changes, lastInsertRowid }. */
  run(sql, params) { throw new NotImplementedError('run'); }
}

module.exports = { DatabaseProvider };
```

### Step 1b — Move SQLite driver into its own folder

Move `src/core/providers/config/db.js` → `src/core/providers/config/sqlite/db.js`.

The file stays functionally identical except it exports a class that extends `DatabaseProvider`:

```js
// src/core/providers/config/sqlite/db.js
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { DatabaseProvider } = require('../../../interfaces/DatabaseProvider');

const DATA_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', 'data');
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'bot.db');

class SqliteDatabaseProvider extends DatabaseProvider {
  constructor() {
    super();
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    this._db = new Database(DB_PATH);
    this._db.pragma('journal_mode = WAL');
    this._runMigrations();
  }

  exec(sql) { return this._db.exec(sql); }
  queryOne(sql, params = []) { return this._db.prepare(sql).get(...params); }
  queryAll(sql, params = []) { return this._db.prepare(sql).all(...params); }
  run(sql, params = []) { return this._db.prepare(sql).run(...params); }

  _runMigrations() {
    // --- existing migration logic (guild_config → tenant_config) unchanged ---
    // paste the full migration block from the original db.js here

    // --- NEW: Slack channel config table ---
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS slack_channel_config (
        workspace_id     TEXT NOT NULL,
        source_channel   TEXT NOT NULL,
        output_channel   TEXT NOT NULL,
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        last_summary_ts  TEXT,
        enabled          INTEGER NOT NULL DEFAULT 1,
        updated_at       INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, source_channel)
      );
    `);
  }
}

// Singleton — one connection per process.
let _instance = null;
function getSqliteDb() {
  if (!_instance) _instance = new SqliteDatabaseProvider();
  return _instance;
}

module.exports = { getSqliteDb, SqliteDatabaseProvider };
```

`last_summary_ts` is a Slack message timestamp string (e.g. `"1712345678.000100"`). The scheduler uses it as the `oldest` cursor for `conversations.history` so each run only covers new messages.

### Step 1c — Provider factory

Create `src/core/providers/config/index.js`. This is the single place that reads `DB_DRIVER` and returns the right instance. **Nothing else** imports a driver directly.

```js
// src/core/providers/config/index.js
const { getSqliteDb } = require('./sqlite/db');
// Future: const { getPostgresDb } = require('./postgres/db');

function getDb() {
  const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
  switch (driver) {
    case 'sqlite': return getSqliteDb();
    // case 'postgres': return getPostgresDb();
    default: throw new Error(`Unknown DB_DRIVER "${driver}". Supported: sqlite`);
  }
}

module.exports = { getDb };
```

### Step 1d — Update `SqliteTenantStore` to accept an injected `db`

Move to `src/core/providers/config/sqlite/sqliteTenantStore.js` and stop importing `db` at module load time. Accept it as a constructor argument instead — this makes it trivially testable and driver-agnostic:

```js
// src/core/providers/config/sqlite/sqliteTenantStore.js
const { TenantConfigStore } = require('../../../interfaces/TenantConfigStore');
const { encrypt, decrypt } = require('../../../utils/crypto');

const ALLOWED_FIELDS = new Set([
  'llm_provider', 'llm_base_url', 'llm_model',
  'stt_provider', 'stt_model_path', 'stt_model_name', 'stt_api_key',
  'summary_channel_id', 'config_role_id',
  'slack_config_role',   // Slack: comma-separated user/group IDs allowed to /aics-config
]);

class SqliteTenantStore extends TenantConfigStore {
  constructor(db) {
    super();
    this._db = db; // DatabaseProvider
  }

  get({ platform, tenantId }) {
    let row = this._db.queryOne(
      'SELECT * FROM tenant_config WHERE platform = ? AND tenant_id = ?',
      [platform, tenantId]
    );
    if (!row) {
      const llmBaseUrl = process.env.LLM_DEFAULT_BASE_URL || 'http://localhost:11434';
      const llmModel = process.env.LLM_DEFAULT_MODEL || 'llama3.1';
      this._db.run(
        `INSERT INTO tenant_config (platform, tenant_id, llm_base_url, llm_model, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [platform, tenantId, llmBaseUrl, llmModel, Date.now()]
      );
      row = this._db.queryOne(
        'SELECT * FROM tenant_config WHERE platform = ? AND tenant_id = ?',
        [platform, tenantId]
      );
    }
    return row;
  }

  update({ platform, tenantId }, patch) {
    this.get({ platform, tenantId });
    const keys = Object.keys(patch).filter(k => ALLOWED_FIELDS.has(k) && patch[k] !== undefined);
    if (keys.length === 0) return this.get({ platform, tenantId });
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => patch[k]);
    this._db.run(
      `UPDATE tenant_config SET ${setClause}, updated_at = ? WHERE platform = ? AND tenant_id = ?`,
      [...values, Date.now(), platform, tenantId]
    );
    return this.get({ platform, tenantId });
  }
}

module.exports = { SqliteTenantStore };
```

> **Backward compatibility note:** The old `sqliteTenantStore.js` exported a singleton `tenantConfig`. Both entrypoints now instantiate `SqliteTenantStore` themselves by calling `new SqliteTenantStore(getDb())`. Remove the old singleton export once Discord's entrypoint is updated.

### Step 1e — Update Discord's entrypoint to use the factory

```js
// src/platforms/discord/entrypoint.js  (updated section)
const { getDb } = require('../../core/providers/config');
const { SqliteTenantStore } = require('../../core/providers/config/sqlite/sqliteTenantStore');

// Inside start():
const db = getDb();
const tenantConfigStore = new SqliteTenantStore(db);
// Pass tenantConfigStore into DiscordCommandGateway (or set it on a shared module)
```

Discord's command handlers currently import the singleton directly. You have two options:
- **Preferred:** Thread `tenantConfigStore` through `DiscordCommandGateway` → `buildCommandMap(tenantConfigStore)` → each command handler receives it as a constructor arg or closure. Mirrors the Slack pattern below.
- **Shortcut:** Keep a module-level singleton in `src/core/providers/config/tenantStore.js` that calls `new SqliteTenantStore(getDb())` once, and import that anywhere. Keeps Discord handlers unchanged for now.

---

## Part 2 — `ChannelConfigStore` interface + SQLite implementation

### Step 2a — Abstract interface

Create `src/core/interfaces/ChannelConfigStore.js`:

```js
// src/core/interfaces/ChannelConfigStore.js
const { NotImplementedError } = require('./_abstract');

class ChannelConfigStore {
  listForWorkspace(workspaceId) { throw new NotImplementedError('listForWorkspace'); }
  get(workspaceId, sourceChannel) { throw new NotImplementedError('get'); }
  set(workspaceId, sourceChannel, { outputChannel, intervalMinutes }) { throw new NotImplementedError('set'); }
  markSummarized(workspaceId, sourceChannel, lastTs) { throw new NotImplementedError('markSummarized'); }
  remove(workspaceId, sourceChannel) { throw new NotImplementedError('remove'); }
}

module.exports = { ChannelConfigStore };
```

### Step 2b — SQLite implementation

Create `src/core/providers/config/sqlite/sqliteChannelConfigStore.js`:

```js
// src/core/providers/config/sqlite/sqliteChannelConfigStore.js
const { ChannelConfigStore } = require('../../../interfaces/ChannelConfigStore');

class SqliteChannelConfigStore extends ChannelConfigStore {
  constructor(db) {
    super();
    this._db = db; // DatabaseProvider
  }

  listForWorkspace(workspaceId) {
    return this._db.queryAll(
      'SELECT * FROM slack_channel_config WHERE workspace_id = ? AND enabled = 1',
      [workspaceId]
    );
  }

  get(workspaceId, sourceChannel) {
    return this._db.queryOne(
      'SELECT * FROM slack_channel_config WHERE workspace_id = ? AND source_channel = ?',
      [workspaceId, sourceChannel]
    ) || null;
  }

  set(workspaceId, sourceChannel, { outputChannel, intervalMinutes }) {
    this._db.run(
      `INSERT INTO slack_channel_config
         (workspace_id, source_channel, output_channel, interval_minutes, enabled, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(workspace_id, source_channel)
       DO UPDATE SET
         output_channel   = excluded.output_channel,
         interval_minutes = excluded.interval_minutes,
         enabled          = 1,
         updated_at       = excluded.updated_at`,
      [workspaceId, sourceChannel, outputChannel, intervalMinutes, Date.now()]
    );
  }

  markSummarized(workspaceId, sourceChannel, lastTs) {
    this._db.run(
      'UPDATE slack_channel_config SET last_summary_ts = ?, updated_at = ? WHERE workspace_id = ? AND source_channel = ?',
      [lastTs, Date.now(), workspaceId, sourceChannel]
    );
  }

  remove(workspaceId, sourceChannel) {
    this._db.run(
      'DELETE FROM slack_channel_config WHERE workspace_id = ? AND source_channel = ?',
      [workspaceId, sourceChannel]
    );
  }
}

module.exports = { SqliteChannelConfigStore };
```

### Step 2c — Expose from factory

Add to `src/core/providers/config/index.js`:

```js
const { SqliteTenantStore } = require('./sqlite/sqliteTenantStore');
const { SqliteChannelConfigStore } = require('./sqlite/sqliteChannelConfigStore');

function getTenantStore() { return new SqliteTenantStore(getDb()); }
function getChannelStore() { return new SqliteChannelConfigStore(getDb()); }

module.exports = { getDb, getTenantStore, getChannelStore };
```

> **Adding Postgres later:** Create `src/core/providers/config/postgres/db.js` that extends `DatabaseProvider` using `pg` (node-postgres). Add `case 'postgres': return getPostgresDb();` to the factory. No other files change.

---

## Part 3 — Slack Bot Implementation

### Environment Variables

```
ENABLE_SLACK=true

# --- Required ---
SLACK_BOT_TOKEN=xoxb-...          # Must start with xoxb-
SLACK_SIGNING_SECRET=...          # 32-char hex string from Basic Information

# --- Production: HTTP Events API ---
SLACK_PORT=3000                   # Port to receive Slack event payloads
# Leave SLACK_APP_TOKEN unset for production HTTP mode.

# --- Development only: Socket Mode ---
# SLACK_APP_TOKEN=xapp-...        # Must start with xapp-; requires connections:write scope
# Setting this switches Bolt to Socket Mode (no public URL needed).

# --- DB driver (defaults to sqlite) ---
DB_DRIVER=sqlite
# DB_DRIVER=postgres
# DATABASE_URL=postgres://user:pass@host:5432/dbname
```

**Socket Mode vs HTTP Events API:**

| | Socket Mode | HTTP Events API |
|---|---|---|
| Use for | Local dev, no public URL | Production |
| Token needed | `SLACK_APP_TOKEN` (xapp-) | None (use signing secret) |
| Bolt config | `socketMode: true, appToken` | `socketMode: false` (default) |
| Slack portal | Enable under Socket Mode | Set Request URL under Event Subscriptions |

### Required Bot Token Scopes

| Scope | Why |
|---|---|
| `channels:history` | Read public channel messages |
| `groups:history` | Read private channel messages |
| `chat:write` | Post summaries |
| `commands` | Register slash commands |
| `files:write` | Upload transcript as file |
| `users:read` | Resolve user display names |
| `channels:read` | Resolve channel names |

---

### Step 3 — `SlackNotificationSink`

Create `src/platforms/slack/SlackNotificationSink.js`:

```js
// src/platforms/slack/SlackNotificationSink.js
const { NotificationSink } = require('../../core/interfaces/NotificationSink');

class SlackNotificationSink extends NotificationSink {
  constructor(webClient) {
    super();
    this.client = webClient;
  }

  async post({ header, summary, transcript, context }) {
    // context: { outputChannel: string, workspaceId: string }

    await this.client.chat.postMessage({
      channel: context.outputChannel,
      text: header,   // plain-text fallback for push notifications
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: header } },
        { type: 'section', text: { type: 'mrkdwn', text: summary.slice(0, 3000) } }
      ]
    });

    if (transcript) {
      await this.client.filesUploadV2({
        channel_id: context.outputChannel,
        filename: 'transcript.txt',
        content: transcript,
        title: `Transcript — ${header}`
      });
    }
  }
}

module.exports = { SlackNotificationSink };
```

---

### Step 4 — `SlackPermissionChecker`

Create `src/platforms/slack/SlackPermissionChecker.js`:

```js
// src/platforms/slack/SlackPermissionChecker.js
const { PermissionChecker } = require('../../core/interfaces/PermissionChecker');

class SlackPermissionChecker extends PermissionChecker {
  constructor(webClient) {
    super();
    this.client = webClient;
  }

  async canConfigure(userId, tenantConfig) {
    const { user } = await this.client.users.info({ user: userId });
    if (user.is_admin || user.is_owner) return true;

    const allowedIds = (tenantConfig.slack_config_role || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    return allowedIds.includes(userId);
  }
}

module.exports = { SlackPermissionChecker };
```

---

### Step 5 — `channelSummary.js`

The core Slack-specific logic. Fetches messages, builds utterances, calls the text pipeline (no audio involved).

```js
// src/platforms/slack/channelSummary.js
const { buildTranscript } = require('../../core/pipeline/buildTranscript');
const { summarize } = require('../../core/pipeline/summarize');
const { getLLM } = require('../../core/registry');
const { SlackNotificationSink } = require('./SlackNotificationSink');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('slack:channelSummary');

/**
 * Fetch messages from sourceChannel since oldestTs, generate a summary,
 * post it to outputChannel.
 *
 * Returns the Slack ts of the newest message processed, or null if no messages.
 */
async function runChannelSummary({ webClient, workspaceId, sourceChannel, outputChannel, tenantConfig, oldestTs }) {
  // 1. Fetch message history (newest-first)
  const result = await webClient.conversations.history({
    channel: sourceChannel,
    oldest: oldestTs,
    limit: 200,
    inclusive: false
  });

  const messages = (result.messages || []).filter(
    m => m.type === 'message' && !m.subtype   // drop joins, topic changes, bot posts
  );

  if (messages.length === 0) {
    log.info({ workspaceId, sourceChannel }, 'No new messages, skipping summary');
    return null;
  }

  const newestTs = messages[0].ts;   // Slack returns newest-first

  // 2. Build utterance list (oldest-first)
  const utterances = messages.slice().reverse().map(m => ({
    userId: m.user || 'unknown',
    displayName: m.user || 'unknown',   // resolved in step 3
    startMs: Math.floor(parseFloat(m.ts) * 1000),
    endMs: Math.floor(parseFloat(m.ts) * 1000) + 1,
    text: m.text
  }));

  // 3. Resolve display names (cached per run)
  const userCache = new Map();
  for (const u of utterances) {
    if (u.userId === 'unknown') continue;
    if (!userCache.has(u.userId)) {
      try {
        const { user } = await webClient.users.info({ user: u.userId });
        userCache.set(u.userId, user.profile.display_name || user.real_name || u.userId);
      } catch {
        userCache.set(u.userId, u.userId);
      }
    }
    u.displayName = userCache.get(u.userId);
  }

  // 4. Build transcript and summarize (text pipeline — no audio step)
  const transcript = buildTranscript(utterances);
  const llm = getLLM(tenantConfig);
  const summary = await summarize(llm, transcript);

  // 5. Post result
  const sourceInfo = await webClient.conversations.info({ channel: sourceChannel });
  const channelName = sourceInfo.channel?.name || sourceChannel;

  const sink = new SlackNotificationSink(webClient);
  await sink.post({
    header: `Channel summary — #${channelName}`,
    summary,
    transcript,
    context: { outputChannel, workspaceId }
  });

  return newestTs;
}

module.exports = { runChannelSummary };
```

> If Slack huddle recording is added later, swap steps 2–4 for `runSummarization()` with real `SpeakerSegment[]` — same pattern as Discord's `/leave`.

---

### Step 6 — `channelScheduler.js`

```js
// src/platforms/slack/channelScheduler.js
const { runChannelSummary } = require('./channelSummary');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('slack:scheduler');

class ChannelScheduler {
  constructor({ webClient, channelConfigStore, tenantConfigStore }) {
    this.webClient = webClient;
    this.channelConfigStore = channelConfigStore;
    this.tenantConfigStore = tenantConfigStore;
    this._timers = new Map();   // key: `${workspaceId}:${sourceChannel}`
  }

  /** Call once at boot — loads timers for all workspaces already in DB. */
  start() {
    // Collect distinct workspace IDs across all enabled configs
    // (requires a listAll() on the store — add it if supporting multi-workspace boot)
    log.info('Scheduler started');
  }

  /** Call after OAuth install for a new workspace. */
  loadWorkspace(workspaceId) {
    const configs = this.channelConfigStore.listForWorkspace(workspaceId);
    for (const cfg of configs) this._startTimer(workspaceId, cfg);
    log.info({ workspaceId, count: configs.length }, 'Loaded channel schedules');
  }

  /** Call after /aics-config channel add or remove. */
  reloadChannel(workspaceId, sourceChannel) {
    const cfg = this.channelConfigStore.get(workspaceId, sourceChannel);
    const key = `${workspaceId}:${sourceChannel}`;
    if (cfg && cfg.enabled) {
      this._startTimer(workspaceId, cfg);
    } else {
      this._clearTimer(key);
    }
  }

  _startTimer(workspaceId, channelCfg) {
    const key = `${workspaceId}:${channelCfg.source_channel}`;
    this._clearTimer(key);
    const intervalMs = channelCfg.interval_minutes * 60 * 1000;
    const timer = setInterval(() => this._runOnce(workspaceId, channelCfg.source_channel), intervalMs);
    this._timers.set(key, timer);
    log.info({ key, intervalMinutes: channelCfg.interval_minutes }, 'Timer started');
  }

  _clearTimer(key) {
    if (this._timers.has(key)) {
      clearInterval(this._timers.get(key));
      this._timers.delete(key);
    }
  }

  async _runOnce(workspaceId, sourceChannel) {
    const cfg = this.channelConfigStore.get(workspaceId, sourceChannel);
    if (!cfg || !cfg.enabled) { this._clearTimer(`${workspaceId}:${sourceChannel}`); return; }

    const tenantConfig = this.tenantConfigStore.get({ platform: 'slack', tenantId: workspaceId });
    try {
      const newestTs = await runChannelSummary({
        webClient: this.webClient,
        workspaceId,
        sourceChannel: cfg.source_channel,
        outputChannel: cfg.output_channel,
        tenantConfig,
        oldestTs: cfg.last_summary_ts || undefined
      });
      if (newestTs) this.channelConfigStore.markSummarized(workspaceId, sourceChannel, newestTs);
    } catch (err) {
      log.error({ err, workspaceId, sourceChannel }, 'Scheduled summary failed');
    }
  }

  stop() {
    for (const timer of this._timers.values()) clearInterval(timer);
    this._timers.clear();
  }
}

module.exports = { ChannelScheduler };
```

---

### Step 7 — Slash commands

#### `/aics-config` (`src/platforms/slack/commands/config.js`)

**Subcommands:**

| Subcommand | Arguments | Action |
|---|---|---|
| `llm` | `provider=`, `base_url=`, `model=` | Update workspace LLM settings |
| `stt` | `provider=`, `model=`, `api_key=` | Update workspace STT settings |
| `channel add` | `source=`, `output=`, `interval=` | Add/update a channel schedule |
| `channel remove` | `source=` | Remove a channel schedule |
| `channel list` | — | List all channel configs |
| `role` | user/group ID | Set who can run config commands |
| `show` | — | Show all workspace settings |

```js
// src/platforms/slack/commands/config.js
const { SlackPermissionChecker } = require('../SlackPermissionChecker');

async function handleConfig({ command, ack, respond, client, channelConfigStore, tenantConfigStore, scheduler }) {
  await ack();

  const workspaceId = command.team_id;
  const userId = command.user_id;
  const cfg = tenantConfigStore.get({ platform: 'slack', tenantId: workspaceId });
  const checker = new SlackPermissionChecker(client);

  if (!await checker.canConfigure(userId, cfg)) {
    return respond({ response_type: 'ephemeral', text: 'You do not have permission to run this command.' });
  }

  const [sub, ...rest] = (command.text || '').trim().split(/\s+/);

  switch (sub) {
    case 'llm': {
      const args = parseKV(rest);
      tenantConfigStore.update({ platform: 'slack', tenantId: workspaceId }, {
        llm_provider: args.provider,
        llm_base_url: args.base_url,
        llm_model: args.model
      });
      return respond({ response_type: 'ephemeral', text: 'LLM config updated.' });
    }

    case 'stt': {
      const args = parseKV(rest);
      tenantConfigStore.update({ platform: 'slack', tenantId: workspaceId }, {
        stt_provider: args.provider,
        stt_model_name: args.model,
        stt_api_key: args.api_key   // encrypted at rest by SqliteTenantStore
      });
      return respond({ response_type: 'ephemeral', text: 'STT config updated.' });
    }

    case 'channel': {
      const [action, ...cRest] = rest;
      const cArgs = parseKV(cRest);

      if (action === 'add') {
        if (!cArgs.source || !cArgs.output) {
          return respond({ response_type: 'ephemeral', text: 'Usage: /aics-config channel add source=<id> output=<id> interval=60' });
        }
        channelConfigStore.set(workspaceId, cArgs.source, {
          outputChannel: cArgs.output,
          intervalMinutes: parseInt(cArgs.interval || '60', 10)
        });
        scheduler.reloadChannel(workspaceId, cArgs.source);
        return respond({ response_type: 'ephemeral', text: `Schedule set: <#${cArgs.source}> → <#${cArgs.output}> every ${cArgs.interval || 60} min.` });
      }

      if (action === 'remove') {
        channelConfigStore.remove(workspaceId, cArgs.source);
        scheduler.reloadChannel(workspaceId, cArgs.source);
        return respond({ response_type: 'ephemeral', text: `Schedule removed for <#${cArgs.source}>.` });
      }

      if (action === 'list') {
        const configs = channelConfigStore.listForWorkspace(workspaceId);
        if (configs.length === 0) return respond({ response_type: 'ephemeral', text: 'No channels configured.' });
        const lines = configs.map(c =>
          `• <#${c.source_channel}> → <#${c.output_channel}> every ${c.interval_minutes} min (${c.enabled ? 'enabled' : 'disabled'})`
        );
        return respond({ response_type: 'ephemeral', text: lines.join('\n') });
      }

      return respond({ response_type: 'ephemeral', text: 'Unknown action. Use: add, remove, list.' });
    }

    case 'role': {
      const roleId = rest[0] || '';
      tenantConfigStore.update({ platform: 'slack', tenantId: workspaceId }, { slack_config_role: roleId });
      return respond({ response_type: 'ephemeral', text: roleId ? `Config role set to ${roleId}.` : 'Config role cleared (admins only).' });
    }

    case 'show': {
      const channels = channelConfigStore.listForWorkspace(workspaceId);
      const text = [
        `*LLM:* ${cfg.llm_provider} / ${cfg.llm_model} (${cfg.llm_base_url})`,
        `*STT:* ${cfg.stt_provider}${cfg.stt_model_name ? ' / ' + cfg.stt_model_name : ''}`,
        `*Config role:* ${cfg.slack_config_role || 'admins only'}`,
        `*Channels monitored:* ${channels.length}`
      ].join('\n');
      return respond({ response_type: 'ephemeral', text });
    }

    default:
      return respond({ response_type: 'ephemeral', text: 'Usage: /aics-config [llm|stt|channel|role|show]' });
  }
}

// ["source=#standup", "output=#summaries"] → { source: '#standup', output: '#summaries' }
function parseKV(parts) {
  return Object.fromEntries(
    parts.filter(p => p.includes('=')).map(p => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
    })
  );
}

module.exports = { handleConfig };
```

#### `/aics-report` (`src/platforms/slack/commands/report.js`)

On-demand summary. No permission restriction — any channel member can request one.

```js
// src/platforms/slack/commands/report.js
const { runChannelSummary } = require('../channelSummary');
const { createLogger } = require('../../../core/utils/logger');

const log = createLogger('slack:report');

async function handleReport({ command, ack, respond, client, tenantConfigStore }) {
  await ack();

  const workspaceId = command.team_id;
  const args = parseKV((command.text || '').trim().split(/\s+/));

  const rawChannel = args.channel || '';
  const channelId = rawChannel.startsWith('#')
    ? await resolveChannelId(client, rawChannel.slice(1))
    : rawChannel.replace(/[<#>|].*$/g, '').replace(/[<#>]/g, '');   // strip <#CXXX|name> syntax

  if (!channelId) {
    return respond({ response_type: 'ephemeral', text: 'Usage: `/aics-report channel=#general interval=60`' });
  }

  const intervalMinutes = parseInt(args.interval || '60', 10);
  const oldestTs = String((Date.now() / 1000) - intervalMinutes * 60);

  await respond({ response_type: 'ephemeral', text: `Generating summary for <#${channelId}> (last ${intervalMinutes} min)…` });

  const tenantConfig = tenantConfigStore.get({ platform: 'slack', tenantId: workspaceId });

  try {
    await runChannelSummary({
      webClient: client,
      workspaceId,
      sourceChannel: channelId,
      outputChannel: channelId,   // post back into the requested channel
      tenantConfig,
      oldestTs
    });
  } catch (err) {
    log.error({ err, workspaceId, channelId }, 'On-demand report failed');
    await respond({ response_type: 'ephemeral', text: `Failed to generate summary: ${err.message}` });
  }
}

async function resolveChannelId(client, name) {
  const result = await client.conversations.list({ types: 'public_channel,private_channel', limit: 1000 });
  return (result.channels || []).find(c => c.name === name)?.id || null;
}

function parseKV(parts) {
  return Object.fromEntries(
    parts.filter(p => p.includes('=')).map(p => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
    })
  );
}

module.exports = { handleReport };
```

---

### Step 8 — `SlackCommandGateway`

```js
// src/platforms/slack/SlackCommandGateway.js
const { App } = require('@slack/bolt');
const { CommandGateway } = require('../../core/interfaces/CommandGateway');
const { handleConfig } = require('./commands/config');
const { handleReport } = require('./commands/report');
const { ChannelScheduler } = require('./channelScheduler');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('slack:gateway');

const HELP_TEXT = `
*AI Call Summarizer — Slack Bot*

*/aics-config llm* \`provider=ollama base_url=http://... model=llama3.1\`
*/aics-config stt* \`provider=whispercpp model=base.en\`
*/aics-config channel add* \`source=<#channel> output=<#channel> interval=60\`
*/aics-config channel remove* \`source=<#channel>\`
*/aics-config channel list*
*/aics-config role* \`U0123ABC\`
*/aics-config show*

*/aics-report* \`channel=#general interval=60\`
`.trim();

class SlackCommandGateway extends CommandGateway {
  constructor({ botToken, signingSecret, appToken, port, tenantConfigStore, channelConfigStore }) {
    super();
    this.tenantConfigStore = tenantConfigStore;
    this.channelConfigStore = channelConfigStore;

    const useSocketMode = !!appToken;

    this.app = new App({
      token: botToken,
      signingSecret,
      socketMode: useSocketMode,
      appToken: useSocketMode ? appToken : undefined,
      port: useSocketMode ? undefined : (port || 3000),
    });

    this.scheduler = new ChannelScheduler({
      webClient: this.app.client,
      channelConfigStore,
      tenantConfigStore
    });
  }

  async start() {
    const { app, tenantConfigStore, channelConfigStore, scheduler } = this;

    app.command('/aics-config', ctx => handleConfig({ ...ctx, channelConfigStore, tenantConfigStore, scheduler }));
    app.command('/aics-report', ctx => handleReport({ ...ctx, tenantConfigStore }));
    app.command('/aics-help', async ({ ack, respond }) => { await ack(); await respond({ response_type: 'ephemeral', text: HELP_TEXT }); });

    await app.start();
    scheduler.start();
    log.info('Slack bot started');
  }

  async stop() {
    this.scheduler.stop();
    await this.app.stop();
    log.info('Slack bot stopped');
  }
}

module.exports = { SlackCommandGateway };
```

---

### Step 9 — Entrypoint

Token validation happens here, before anything else is instantiated. Required tokens are checked against their expected prefixes (`xoxb-` for bot tokens, `xapp-` for app-level Socket Mode tokens). This matches the same fail-fast pattern Discord uses for `DISCORD_TOKEN` / `DISCORD_APP_ID`.

```js
// src/platforms/slack/entrypoint.js
const { getTenantStore, getChannelStore } = require('../../core/providers/config');
const { SlackCommandGateway } = require('./SlackCommandGateway');
const { createLogger } = require('../../core/utils/logger');

const log = createLogger('slack:main');

// Registered at module load, not inside start(), so they don't stack if start() is retried.
let _gateway = null;

process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err }));
process.on('uncaughtException',  (err) => log.error('uncaughtException',  { err }));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info('shutdown', { signal });
    const stop = _gateway ? _gateway.stop() : Promise.resolve();
    stop.finally(() => process.exit(0));
  });
}

function validateEnv() {
  const errors = [];

  const botToken = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const appToken = process.env.SLACK_APP_TOKEN;   // optional — only required for Socket Mode

  if (!botToken) {
    errors.push('SLACK_BOT_TOKEN is not set');
  } else if (!botToken.startsWith('xoxb-')) {
    errors.push('SLACK_BOT_TOKEN looks wrong — bot tokens must start with "xoxb-"');
  }

  if (!signingSecret) {
    errors.push('SLACK_SIGNING_SECRET is not set');
  } else if (signingSecret.length < 32) {
    errors.push('SLACK_SIGNING_SECRET looks wrong — expected a 32-char hex string');
  }

  if (appToken && !appToken.startsWith('xapp-')) {
    errors.push('SLACK_APP_TOKEN looks wrong — app-level tokens must start with "xapp-"');
  }

  if (errors.length > 0) {
    throw new Error(
      'Slack: missing or invalid env vars:\n' +
      errors.map(e => `  • ${e}`).join('\n') +
      '\n\nSee docs/slack-bot-implementation.md — Environment Variables.'
    );
  }

  return { botToken, signingSecret, appToken };
}

async function start() {
  const { botToken, signingSecret, appToken } = validateEnv();

  _gateway = new SlackCommandGateway({
    botToken,
    signingSecret,
    appToken,                                        // undefined in production HTTP mode
    port: parseInt(process.env.SLACK_PORT || '3000', 10),
    tenantConfigStore: getTenantStore(),
    channelConfigStore: getChannelStore()
  });

  try {
    await _gateway.start();
  } catch (err) {
    log.error('startup failed', { err });
    throw err;
  }
}

module.exports = { start };
```

Also add the same kind of `validateEnv` to Discord's entrypoint (currently it throws a plain `Error` for missing tokens but does no prefix check):

```js
// src/platforms/discord/entrypoint.js — updated validateEnv
function validateEnv() {
  const token = process.env.DISCORD_TOKEN;
  const appId = process.env.DISCORD_APP_ID;
  const errors = [];

  if (!token) errors.push('DISCORD_TOKEN is not set');
  // Discord bot tokens are base64 segments separated by dots; rough sanity check:
  else if (!token.includes('.')) errors.push('DISCORD_TOKEN looks wrong — expected a bot token with dots');

  if (!appId) errors.push('DISCORD_APP_ID is not set');
  else if (!/^\d+$/.test(appId)) errors.push('DISCORD_APP_ID must be a numeric snowflake ID');

  if (errors.length > 0) {
    throw new Error(
      'Discord: missing or invalid env vars:\n' +
      errors.map(e => `  • ${e}`).join('\n')
    );
  }

  return { token, appId, devGuildId: process.env.DISCORD_DEV_GUILD_ID || null };
}
```

Wire Slack into the multi-platform launcher:

```js
// src/index.js
if (process.env.ENABLE_SLACK === 'true') {
  const { start } = require('./platforms/slack/entrypoint');
  platforms.push(start());
}
```

Add launcher and npm script:

```js
// bin/start-slack.js
require('../src/platforms/slack/entrypoint').start().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

```json
"scripts": {
  "start:slack": "node bin/start-slack.js"
}
```

---

## Slack App Setup (Developer Portal)

### Development (Socket Mode)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. **Socket Mode** → Enable → generate App-Level Token with scope `connections:write` → save as `SLACK_APP_TOKEN`.
3. **OAuth & Permissions** → Bot Token Scopes → add all scopes listed above.
4. **Slash Commands** → create `/aics-config`, `/aics-report`, `/aics-help` (Request URL can be anything in Socket Mode).
5. **Install App** → Install to workspace → copy Bot User OAuth Token → save as `SLACK_BOT_TOKEN`.
6. **Basic Information** → App Credentials → copy Signing Secret → save as `SLACK_SIGNING_SECRET`.

### Production (HTTP Events API)

1. Same as above through step 3, but **do not enable Socket Mode**.
2. Deploy the bot behind a TLS-terminating reverse proxy (nginx, Caddy, etc.) or on a PaaS that provides HTTPS.
3. **Event Subscriptions** → Enable → set Request URL to `https://your-domain/slack/events`. Slack will send a `url_verification` challenge — Bolt handles this automatically.
4. **Slash Commands** → set each command's Request URL to `https://your-domain/slack/events`.
5. Set `SLACK_PORT=3000` (or whatever port the process listens on behind the proxy).
6. **Do not set `SLACK_APP_TOKEN`** — its absence tells `SlackCommandGateway` to use HTTP mode.

### Token rotation

Bot tokens (`xoxb-`) do not expire but should be rotated if compromised:
- **Revoke:** App settings → OAuth & Permissions → Revoke Token.
- **Reissue:** Reinstall the app to get a new token, update `SLACK_BOT_TOKEN`, restart the process.

Signing secrets are used to verify that payloads come from Slack. Rotate via **Basic Information** → **App Credentials** → **Rotate**.

---

## Data Flow Summary

### Scheduled summary

```
ChannelScheduler timer fires
  → _runOnce(workspaceId, sourceChannel)
    → channelConfigStore.get() — check still enabled
    → tenantConfigStore.get() — get LLM/STT config
    → runChannelSummary()
        → conversations.history (oldest = last_summary_ts)
        → Build utterance list + resolve display names
        → buildTranscript() → plain-text
        → summarize(llm, transcript) → Markdown
        → SlackNotificationSink.post() → chat.postMessage + filesUploadV2
    → channelConfigStore.markSummarized(newestTs)
```

### On-demand report (`/aics-report`)

```
User runs /aics-report channel=#general interval=60
  → handleReport()
    → Resolve channel ID
    → oldestTs = now - interval*60
    → runChannelSummary() → posts into source channel
```

### Config change (`/aics-config channel add`)

```
User runs /aics-config channel add source=C123 output=C456 interval=30
  → handleConfig()
    → SlackPermissionChecker.canConfigure()
    → channelConfigStore.set()
    → scheduler.reloadChannel() → clears old timer, starts new one
```

---

## Testing Checklist

- [ ] Process exits immediately with a clear error if `SLACK_BOT_TOKEN` is missing or has wrong prefix
- [ ] Process exits immediately with a clear error if `SLACK_SIGNING_SECRET` is missing or too short
- [ ] `SLACK_APP_TOKEN` set → Bolt starts in Socket Mode; unset → HTTP mode on `SLACK_PORT`
- [ ] `/aics-config show` returns current workspace config (ephemeral)
- [ ] `/aics-config llm provider=ollama base_url=http://localhost:11434 model=llama3.1` updates DB
- [ ] `/aics-config channel add source=<id> output=<id> interval=5` creates DB row and starts timer
- [ ] Timer fires after 5 min and posts summary; `last_summary_ts` advances; next run covers only new messages
- [ ] `/aics-config channel remove source=<id>` stops timer and removes DB row
- [ ] `/aics-report channel=#general interval=60` posts summary immediately
- [ ] Non-admin rejected by `/aics-config` with ephemeral error
- [ ] User added via `/aics-config role` can run `/aics-config`
- [ ] Empty channel (no messages in window) → no post, info log
- [ ] Long summary truncated to 3000 chars in Block Kit; full transcript attached as file
- [ ] `DB_DRIVER=sqlite` uses SQLite; factory throws on unknown driver value
