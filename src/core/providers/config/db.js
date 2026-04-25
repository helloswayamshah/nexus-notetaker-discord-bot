const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DATA_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ---------- Migration: guild_config → tenant_config ----------
// Check if old schema exists and needs migration.
const hasGuildConfig = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'"
).get();

const hasTenantConfig = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_config'"
).get();

if (hasGuildConfig && !hasTenantConfig) {
  // Ensure stt_model_name column exists before migration (previous incremental migration).
  const cols = db.prepare('PRAGMA table_info(guild_config)').all();
  if (!cols.some((c) => c.name === 'stt_model_name')) {
    db.exec('ALTER TABLE guild_config ADD COLUMN stt_model_name TEXT');
  }

  // Migrate: rename table, add platform column, rename guild_id → tenant_id.
  db.exec(`
    ALTER TABLE guild_config RENAME TO tenant_config;
    ALTER TABLE tenant_config ADD COLUMN platform TEXT NOT NULL DEFAULT 'discord';
    ALTER TABLE tenant_config RENAME COLUMN guild_id TO tenant_id;
  `);

  // Create composite unique index.
  const idxExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='tenant_config_pk'"
  ).get();
  if (!idxExists) {
    db.exec('CREATE UNIQUE INDEX tenant_config_pk ON tenant_config(platform, tenant_id)');
  }
} else if (!hasTenantConfig) {
  // Fresh install — create new schema directly.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_config (
      tenant_id          TEXT NOT NULL,
      platform           TEXT NOT NULL DEFAULT 'discord',
      llm_provider       TEXT NOT NULL DEFAULT 'ollama',
      llm_base_url       TEXT NOT NULL DEFAULT 'http://localhost:11434',
      llm_model          TEXT NOT NULL DEFAULT 'llama3.1',
      stt_provider       TEXT NOT NULL DEFAULT 'whispercpp',
      stt_model_path     TEXT,
      stt_model_name     TEXT,
      stt_api_key        TEXT,
      summary_channel_id TEXT,
      config_role_id     TEXT,
      updated_at         INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tenant_config_pk ON tenant_config(platform, tenant_id);
  `);
} else {
  // tenant_config already exists (already migrated) — ensure stt_model_name column exists.
  const cols = db.prepare('PRAGMA table_info(tenant_config)').all();
  if (!cols.some((c) => c.name === 'stt_model_name')) {
    db.exec('ALTER TABLE tenant_config ADD COLUMN stt_model_name TEXT');
  }
}

module.exports = { db, DATA_DIR };
